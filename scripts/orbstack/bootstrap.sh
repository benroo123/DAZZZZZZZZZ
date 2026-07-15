#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-up}"
REPO_ROOT="${2:?repository path inside OrbStack is required}"
MINIO_RELEASE="RELEASE.2025-04-22T22-12-26Z"
export DEBIAN_FRONTEND=noninteractive

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

install_packages() {
  if ! command -v psql >/dev/null || ! command -v redis-server >/dev/null || ! command -v rabbitmqctl >/dev/null; then
    apt-get update
    apt-get install -y --no-install-recommends \
      ca-certificates curl postgresql postgresql-contrib postgresql-16-postgis-3 \
      redis-server rabbitmq-server
  fi

  if ! command -v minio >/dev/null; then
    local architecture
    architecture="$(dpkg --print-architecture)"
    case "${architecture}" in
      arm64) architecture="arm64" ;;
      amd64) architecture="amd64" ;;
      *) echo "Unsupported MinIO architecture: ${architecture}" >&2; exit 1 ;;
    esac
    curl -fsSL \
      "https://dl.min.io/server/minio/release/linux-${architecture}/archive/minio.${MINIO_RELEASE}" \
      -o /usr/local/bin/minio
    chmod 0755 /usr/local/bin/minio
  fi
}

configure_postgres() {
  systemctl enable --now postgresql >/dev/null
  local config_file hba_file
  config_file="$(runuser -u postgres -- psql -Atc 'show config_file')"
  hba_file="$(runuser -u postgres -- psql -Atc 'show hba_file')"
  if ! grep -q 'dachang-orbstack' "${config_file}"; then
    printf "\n# dachang-orbstack\nlisten_addresses = '*'\npassword_encryption = 'scram-sha-256'\n" >>"${config_file}"
  fi
  if ! grep -q 'dachang-orbstack' "${hba_file}"; then
    printf "\n# dachang-orbstack\nhost all all 0.0.0.0/0 scram-sha-256\nhost all all ::/0 scram-sha-256\n" >>"${hba_file}"
  fi
  systemctl restart postgresql
}

configure_redis() {
  if ! grep -q 'dachang-orbstack' /etc/redis/redis.conf; then
    printf "\n# dachang-orbstack\nbind 0.0.0.0 ::1\nprotected-mode no\nrequirepass dachang\n" >>/etc/redis/redis.conf
  fi
  systemctl enable --now redis-server >/dev/null
  systemctl restart redis-server
}

configure_rabbitmq() {
  rabbitmq-plugins enable --offline rabbitmq_management >/dev/null
  systemctl enable --now rabbitmq-server >/dev/null
  rabbitmqctl await_startup

  if [[ "${MODE}" == "reset" ]]; then
    rabbitmqctl stop_app
    rabbitmqctl reset
    rabbitmqctl start_app
  fi

  if rabbitmqctl list_users --silent | awk '{print $1}' | grep -qx dachang; then
    rabbitmqctl change_password dachang dachang >/dev/null
  else
    rabbitmqctl add_user dachang dachang >/dev/null
  fi
  rabbitmqctl set_user_tags dachang administrator >/dev/null
  rabbitmqctl set_permissions -p / dachang '.*' '.*' '.*' >/dev/null
}

configure_minio() {
  if ! id -u minio-user >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/minio --shell /usr/sbin/nologin minio-user
  fi
  install -d -o minio-user -g minio-user /var/lib/minio/data
  printf '%s\n' \
    'MINIO_ROOT_USER=dachang' \
    'MINIO_ROOT_PASSWORD=dachang-local-secret' \
    > /etc/default/minio
  cat >/etc/systemd/system/minio.service <<'UNIT'
[Unit]
Description=DAZZZZZZZZZ local MinIO object storage
After=network-online.target
Wants=network-online.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server /var/lib/minio/data --address :9000 --console-address :9001
Restart=on-failure
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  if [[ "${MODE}" == "reset" ]]; then
    systemctl stop minio 2>/dev/null || true
    rm -rf /var/lib/minio/data/*
  fi
  systemctl enable --now minio >/dev/null
}

initialize_database() {
  if [[ "${MODE}" == "reset" ]]; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c \
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'dachang' and pid <> pg_backend_pid()" >/dev/null
    runuser -u postgres -- dropdb --if-exists dachang
  fi

  if ! runuser -u postgres -- psql -Atc "select 1 from pg_roles where rolname = 'dachang'" | grep -q 1; then
    runuser -u postgres -- createuser --login dachang
  fi
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "alter user dachang with password 'dachang'" >/dev/null

  if ! runuser -u postgres -- psql -Atc "select 1 from pg_database where datname = 'dachang'" | grep -q 1; then
    runuser -u postgres -- createdb --owner=dachang dachang
  fi

  if ! runuser -u postgres -- psql -d dachang -Atc "select to_regclass('app.users')" | grep -q users; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d dachang \
      -f "${REPO_ROOT}/activity-social-app-product/database/schema.sql"
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d dachang \
      -f "${REPO_ROOT}/infra/db/002-runtime.sql"
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d dachang \
      -f "${REPO_ROOT}/infra/db/003-seed.sql"
  fi

  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d dachang <<'SQL' >/dev/null
ALTER SCHEMA app OWNER TO dachang;
GRANT USAGE, CREATE ON SCHEMA app TO dachang;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA app TO dachang;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA app TO dachang;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO dachang;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT ALL ON TABLES TO dachang;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT ALL ON SEQUENCES TO dachang;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO dachang;
SQL
}

reset_ephemeral_state() {
  if [[ "${MODE}" == "reset" ]]; then
    redis-cli -a dachang --no-auth-warning flushall >/dev/null
  fi
}

verify_services() {
  systemctl is-active --quiet postgresql redis-server rabbitmq-server minio
  PGPASSWORD=dachang psql -h 127.0.0.1 -U dachang -d dachang -Atc 'select 1' >/dev/null
  redis-cli -a dachang --no-auth-warning ping >/dev/null
  rabbitmq-diagnostics -q ping >/dev/null
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null; then
      return
    fi
    sleep 1
  done
  echo "MinIO did not become ready" >&2
  exit 1
}

install_packages
configure_postgres
configure_redis
configure_rabbitmq
configure_minio
initialize_database
reset_ephemeral_state
verify_services
