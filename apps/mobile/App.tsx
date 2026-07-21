import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  ImageStyle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api,
  Candidate,
  Conversation,
  FeedItem,
  Message,
  Profile,
  waitForPublished,
} from './src/api';
import { getMobileLayout, MobileLayout } from './src/layout';
import { defaultTheme, ThemeKey, themeEntries, ThemeTokens, themes } from './src/themes';

type TabKey = 'home' | 'match' | 'publish' | 'messages' | 'profile';
type AppStyles = ReturnType<typeof createStyles>;

const tabs: Array<{ key: TabKey; icon: string; label: string }> = [
  { key: 'home', icon: '⌂', label: '首页' },
  { key: 'match', icon: '♢', label: '搭子' },
  { key: 'publish', icon: '＋', label: '发布' },
  { key: 'messages', icon: '✉', label: '消息' },
  { key: 'profile', icon: '☺', label: '我的' },
];

const categories = ['全部', '运动', 'Citywalk', '音乐', '展览', '桌游'];

function AppButton({
  children,
  onPress,
  theme,
  styles,
  secondary = false,
  testID,
  disabled = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  theme: ThemeTokens;
  styles: AppStyles;
  secondary?: boolean;
  testID?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: theme.text }]}>{children}</Text>
    </Pressable>
  );
}

function Tag({ children, theme, styles }: { children: React.ReactNode; theme: ThemeTokens; styles: AppStyles }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{children}</Text>
    </View>
  );
}

function Cover({
  uri,
  theme,
  styles,
  style,
}: {
  uri?: string | null;
  theme: ThemeTokens;
  styles: AppStyles;
  style?: StyleProp<ImageStyle | ViewStyle>;
}) {
  if (uri) {
    return <Image accessibilityLabel="内容图片" source={{ uri }} resizeMode="cover" style={[styles.cover, style] as never} />;
  }
  return (
    <View style={[styles.cover, styles.coverFallback, style]}>
      <Text style={{ color: theme.brand, fontSize: 30 }}>搭</Text>
    </View>
  );
}

function FeedCard({ item, theme, styles }: { item: FeedItem; theme: ThemeTokens; styles: AppStyles }) {
  return (
    <View
      testID={`feed-card-${item.entityType}`}
      style={[
        styles.feedCard,
        { borderLeftColor: item.entityType === 'activity' ? theme.activity : theme.post },
      ]}
    >
      {item.entityType === 'place' ? (
        <View style={styles.cardContent}>
          <Text style={styles.cardKind}>地点</Text>
          <Text style={styles.cardTitle}>⌖ {(item as FeedItem & { name?: string }).name}</Text>
          <Text style={styles.cardBody}>上海 · 点击查看附近活动</Text>
        </View>
      ) : item.entityType === 'user' ? (
        <View style={styles.userResult}>
          <Cover uri={item.imageUrl} theme={theme} styles={styles} style={styles.userResultImage} />
          <View style={styles.flex}>
            <Text style={styles.cardKind}>人员</Text>
            <Text style={styles.cardTitle}>{item.displayName}</Text>
            <Text style={styles.cardBody}>ID {item.publicId}</Text>
          </View>
        </View>
      ) : (
        <>
          <Cover uri={item.imageUrl} theme={theme} styles={styles} />
          <View style={styles.cardContent}>
            <View style={styles.cardMetaRow}>
              <Text
                style={[
                  styles.cardKind,
                  { color: item.entityType === 'activity' ? theme.activity : theme.post },
                ]}
              >
                {item.entityType === 'activity' ? '组活动' : '发动态'}
              </Text>
              <Text style={styles.cardAuthor}>
                {item.author?.displayName} {item.author?.realNameVerified ? '✓实名' : ''}
              </Text>
            </View>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody} numberOfLines={3}>{item.body}</Text>
            {item.entityType === 'activity' ? (
              <>
                <View style={styles.tagRow}>
                  <Tag theme={theme} styles={styles}>{item.category}</Tag>
                  <Tag theme={theme} styles={styles}>{item.distanceKm} km</Tag>
                  <Tag theme={theme} styles={styles}>{item.participants?.approved}/{item.participants?.max} 人</Tag>
                </View>
                <Text style={styles.cardFoot}>⌖ {item.venueName} · {item.startsAt ? new Date(item.startsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</Text>
              </>
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}

function HomeScreen({ theme, styles }: { theme: ThemeTokens; styles: AppStyles }) {
  const [mode, setMode] = useState<'recommended' | 'city'>('recommended');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [category, setCategory] = useState('全部');
  const [distance, setDistance] = useState(10);
  const [time, setTime] = useState('本周');
  const [people, setPeople] = useState(50);

  const loadFeed = useCallback(async (nextMode: 'recommended' | 'city') => {
    setLoading(true);
    setError('');
    try {
      setItems((await api.feed(nextMode)).items);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed(mode);
  }, [loadFeed, mode]);

  async function runSearch() {
    if (!query.trim()) return loadFeed(mode);
    setLoading(true);
    setError('');
    try {
      setItems((await api.search(query)).items);
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters() {
    setFilterOpen(false);
    setLoading(true);
    try {
      setItems((await api.nearby({ category, people })).items);
      setMode('city');
    } catch (nextError) {
      setError((nextError as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const listHeader = (
    <>
      <View style={styles.brandRow}>
        <View style={styles.brandCopy}>
          <Text style={styles.eyebrow}>一起，真的去做点什么</Text>
          <Text style={styles.brandTitle}>DAZZZZZZZZZ</Text>
        </View>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>AI 原生</Text>
        </View>
      </View>
      <View style={styles.segment}>
        {(['recommended', 'city'] as const).map((entry) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: mode === entry }}
            testID={`feed-${entry}`}
            key={entry}
            onPress={() => setMode(entry)}
            style={[styles.segmentButton, mode === entry && styles.segmentButtonActive]}
          >
            <Text style={[styles.segmentText, mode === entry && styles.segmentTextActive]}>
              {entry === 'recommended' ? '推荐' : '同城 · 上海'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={{ color: theme.muted }}>⌕</Text>
          <TextInput
            accessibilityLabel="搜索活动、地名、名称、帖子或人员"
            testID="home-search"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void runSearch()}
            placeholder="活动 / 地名 / 名称 / 帖子 / 人员"
            placeholderTextColor={theme.muted}
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          accessibilityLabel="打开筛选"
          accessibilityRole="button"
          testID="filter-button"
          onPress={() => setFilterOpen(true)}
          style={styles.filterButton}
        >
          <Text style={styles.filterButtonText}>筛选</Text>
        </Pressable>
      </View>
      <View style={styles.legendRow}>
        <View style={[styles.legendDot, { backgroundColor: theme.activity }]} />
        <Text style={styles.legendText}>活动</Text>
        <View style={[styles.legendDot, { backgroundColor: theme.post }]} />
        <Text style={styles.legendText}>动态</Text>
        <Text style={[styles.legendText, styles.resultCount]}>{items.length} 条结果</Text>
      </View>
      {loading ? <ActivityIndicator color={theme.brand} style={styles.listLoader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );

  return (
    <View style={styles.flex} testID="home-screen">
      <FlatList
        data={items}
        keyExtractor={(item) => `${item.entityType}-${item.id}`}
        renderItem={({ item }) => <FeedCard item={item} theme={theme} styles={styles} />}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>没有找到，换个关键词试试。</Text> : null}
        contentContainerStyle={styles.screen}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
      <Modal
        animationType="slide"
        transparent
        visible={filterOpen}
        onRequestClose={() => setFilterOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable testID="filter-panel" style={styles.sheet} onPress={() => undefined}>
            <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>筛选同城活动</Text>
              <Text style={styles.fieldLabel}>活动类型</Text>
              <View style={styles.optionWrap}>
                {categories.map((entry) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: category === entry }}
                    key={entry}
                    onPress={() => setCategory(entry)}
                    style={[styles.choice, category === entry && styles.choiceActive]}
                  >
                    <Text style={[styles.choiceText, category === entry && styles.choiceTextActive]}>{entry}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>地点</Text>
              <View style={styles.readOnlyField}><Text style={styles.inputText}>上海市 · 当前定位附近</Text></View>
              <Text style={styles.fieldLabel}>距离</Text>
              <View style={styles.optionWrap}>
                {[3, 5, 10, 30].map((entry) => (
                  <Pressable key={entry} onPress={() => setDistance(entry)} style={[styles.choice, distance === entry && styles.choiceActive]}>
                    <Text style={[styles.choiceText, distance === entry && styles.choiceTextActive]}>{entry} km</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>时间</Text>
              <View style={styles.optionWrap}>
                {['今天', '周末', '本周', '自定义'].map((entry) => (
                  <Pressable key={entry} onPress={() => setTime(entry)} style={[styles.choice, time === entry && styles.choiceActive]}>
                    <Text style={[styles.choiceText, time === entry && styles.choiceTextActive]}>{entry}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldLabel}>活动人数上限</Text>
              <View style={styles.optionWrap}>
                {[6, 12, 20, 50].map((entry) => (
                  <Pressable key={entry} onPress={() => setPeople(entry)} style={[styles.choice, people === entry && styles.choiceActive]}>
                    <Text style={[styles.choiceText, people === entry && styles.choiceTextActive]}>{entry} 人</Text>
                  </Pressable>
                ))}
              </View>
              <AppButton testID="apply-filter" onPress={() => void applyFilters()} theme={theme} styles={styles}>查看活动</AppButton>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function MatchScreen({ theme, styles }: { theme: ThemeTokens; styles: AppStyles }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const candidate = candidates[index % Math.max(candidates.length, 1)];

  useEffect(() => {
    api.candidates().then((result) => setCandidates(result.items)).catch((error) => setStatus(error.message)).finally(() => setLoading(false));
  }, []);

  async function decide(decision: 'pass' | 'like' | 'super_like') {
    if (!candidate) return;
    try {
      const result = await api.swipe(candidate.id, decision);
      setStatus(result.matched ? '配对成功，可以去消息里打招呼了' : decision === 'pass' ? '已略过' : '已发送喜欢');
      setIndex((value) => value + 1);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      testID="match-screen"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <View><Text style={styles.eyebrow}>一对一发现</Text><Text style={styles.pageTitle}>找搭子</Text></View>
        <View style={styles.safetyPill}><Text style={styles.safetyText}>安全偏好已开启</Text></View>
      </View>
      {loading ? <ActivityIndicator color={theme.brand} style={{ marginTop: 80 }} /> : null}
      {!loading && candidate ? (
        <View style={styles.matchCard}>
          <Cover uri={candidate.imageUrl} theme={theme} styles={{ ...styles, cover: styles.matchImage }} />
          <View style={styles.matchGradient}>
            <View style={styles.nameRow}>
              <Text style={styles.matchName}>{candidate.displayName}, {candidate.age}</Text>
              {candidate.realNameVerified ? <Text style={styles.verified}>✓ 实名</Text> : null}
            </View>
            <Text style={styles.matchId}>ID {candidate.publicId} · {candidate.occupation} · {candidate.personalityLabel}</Text>
            <Text style={styles.matchBio}>{candidate.bio}</Text>
            <View style={styles.tagRow}>{candidate.interests.map((interest) => <Tag key={interest} theme={theme} styles={styles}>{interest}</Tag>)}</View>
          </View>
        </View>
      ) : null}
      {status ? <Text testID="swipe-status" style={styles.status}>{status}</Text> : null}
      {!loading && !candidate ? <Text style={styles.empty}>暂时没有更多搭子</Text> : null}
      <View style={styles.swipeActions}>
        <Pressable accessibilityLabel="略过" onPress={() => void decide('pass')} style={[styles.circleAction, { borderColor: theme.muted }]}><Text style={[styles.circleIcon, { color: theme.muted }]}>×</Text></Pressable>
        <Pressable accessibilityLabel="特别喜欢" onPress={() => void decide('super_like')} style={[styles.circleAction, styles.circleActionSmall]}><Text style={[styles.circleIcon, { color: theme.accent, fontSize: 25 }]}>★</Text></Pressable>
        <Pressable accessibilityLabel="喜欢" testID="swipe-like" onPress={() => void decide('like')} style={[styles.circleAction, { backgroundColor: theme.brand, borderColor: theme.brand }]}><Text style={[styles.circleIcon, { color: theme.dark ? theme.background : '#FFFFFF' }]}>♥</Text></Pressable>
      </View>
      <Text style={styles.helper}>不是相亲：匹配的是兴趣、安全偏好与想参加的活动。</Text>
    </ScrollView>
  );
}

function PublishScreen({ theme, styles }: { theme: ThemeTokens; styles: AppStyles }) {
  const [kind, setKind] = useState<'post' | 'activity'>('activity');
  const [text, setText] = useState('周末想找几个人一起在苏州河边散步拍照，新手友好');
  const [title, setTitle] = useState('苏州河周末散步拍照');
  const [category, setCategory] = useState('Citywalk');
  const [minPeople, setMinPeople] = useState(3);
  const [maxPeople, setMaxPeople] = useState(8);
  const [aiPlan, setAiPlan] = useState<{ agenda: Array<{ time: string; item: string }>; safetyNotes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function generatePlan() {
    if (text.trim().length < 3) return setStatus('先用一句话描述你想做的事');
    setBusy(true);
    setStatus('AI 正在补齐活动方案…');
    try {
      const result = await api.plan(text, maxPeople);
      setTitle(result.title);
      setAiPlan(result);
      setStatus('方案已生成，你确认后再发布');
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!text.trim()) return setStatus('请填写内容');
    setBusy(true);
    setStatus('已受理，正在生成 AI 配图并审核…');
    try {
      if (kind === 'post') {
        const draft = await api.createPost(text);
        await api.publishPost(draft.id);
        await waitForPublished(draft.id);
        setStatus('发布成功 · AI 配图已生成并标注');
      } else {
        const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
        const draft = await api.createActivity({
          title,
          description: text,
          category,
          minParticipants: minPeople,
          maxParticipants: maxPeople,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          cityCode: '310100',
          venueName: '上海 · 组织者确认后公开精确位置',
          mediaIds: [],
          autoGenerateCover: true,
        });
        await api.publishActivity(draft.id);
        setStatus('活动已提交 · AI 配图与安全审核在后台处理');
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={8}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="publish-screen"
      >
      <Text style={styles.eyebrow}>把操作交给 AI</Text>
      <Text style={styles.pageTitle}>说一句，就能组局</Text>
      <View style={styles.segment}>
        {(['activity', 'post'] as const).map((entry) => (
          <Pressable key={entry} testID={`publish-${entry}`} onPress={() => setKind(entry)} style={[styles.segmentButton, kind === entry && styles.segmentButtonActive]}>
            <Text style={[styles.segmentText, kind === entry && styles.segmentTextActive]}>{entry === 'activity' ? '组织活动' : '发布动态'}</Text>
          </Pressable>
        ))}
      </View>
      {kind === 'activity' ? (
        <>
          <Text style={styles.fieldLabel}>活动标题</Text>
          <TextInput accessibilityLabel="活动标题" value={title} onChangeText={setTitle} style={styles.input} placeholderTextColor={theme.muted} />
        </>
      ) : null}
      <Text style={styles.fieldLabel}>你想做什么？</Text>
      <TextInput
        accessibilityLabel="发布内容"
        testID="publish-content"
        multiline
        value={text}
        onChangeText={setText}
        style={styles.textArea}
        placeholder="例如：周六下午想在徐汇找 6 个人打羽毛球…"
        placeholderTextColor={theme.muted}
      />
      {kind === 'activity' ? (
        <>
          <View style={styles.inlineFields}>
            <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>类型</Text><TextInput accessibilityLabel="活动类型" value={category} onChangeText={setCategory} style={styles.input} /></View>
            <View style={{ flex: 1 }}><Text style={styles.fieldLabel}>人数 2–50</Text><View style={styles.stepper}><Pressable accessibilityLabel="减少人数" hitSlop={8} onPress={() => setMaxPeople((value) => Math.max(2, value - 1))} style={styles.stepperButton}><Text style={styles.stepperControl}>−</Text></Pressable><Text style={styles.stepperValue}>{maxPeople}</Text><Pressable accessibilityLabel="增加人数" hitSlop={8} onPress={() => setMaxPeople((value) => Math.min(50, value + 1))} style={styles.stepperButton}><Text style={styles.stepperControl}>＋</Text></Pressable></View></View>
          </View>
          <Text style={styles.fieldLabel}>最低成团人数</Text>
          <View style={styles.optionWrap}>{[2, 3, 4, 6].map((value) => <Pressable key={value} onPress={() => setMinPeople(Math.min(value, maxPeople))} style={[styles.choice, minPeople === value && styles.choiceActive]}><Text style={[styles.choiceText, minPeople === value && styles.choiceTextActive]}>{value} 人</Text></Pressable>)}</View>
          <AppButton secondary onPress={() => void generatePlan()} theme={theme} styles={styles}>{busy ? '生成中…' : '✦ AI 补齐时间表与安全提示'}</AppButton>
        </>
      ) : null}
      <View style={styles.aiMediaCard}>
        <View style={styles.aiMediaPreview}><Text style={{ fontSize: 30 }}>✦</Text></View>
        <View style={{ flex: 1 }}><Text style={styles.aiMediaTitle}>图片为必填项</Text><Text style={styles.aiMediaText}>未选择照片，将根据正文自动生成并标注 AI 来源。</Text></View>
        <Text style={styles.enabledText}>已开启</Text>
      </View>
      {aiPlan ? (
        <View testID="ai-plan" style={styles.planCard}>
          <Text style={styles.planTitle}>AI 活动草案</Text>
          {aiPlan.agenda.map((item) => <Text key={item.time} style={styles.planLine}>{item.time}　{item.item}</Text>)}
          <Text style={styles.planSafety}>安全：{aiPlan.safetyNotes.join('；')}</Text>
        </View>
      ) : null}
      {status ? <Text testID="publish-status" style={styles.status}>{status}</Text> : null}
      <AppButton testID="publish-submit" disabled={busy} onPress={() => void publish()} theme={theme} styles={styles}>{busy ? '处理中…' : kind === 'activity' ? '确认并发布活动' : '确认并发布动态'}</AppButton>
      <Text style={styles.helper}>所有 AI 生成内容都保留来源记录，发布前由你确认。</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function MessagesScreen({ theme, styles }: { theme: ThemeTokens; styles: AppStyles }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [social, setSocial] = useState({ following: 0, followers: 0 });
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.conversations().then((result) => { setConversations(result.items); setSocial(result.social); }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActive(null);
      return true;
    });
    return () => subscription.remove();
  }, [active]);

  async function openConversation(conversation: Conversation) {
    setBlocked(false);
    try {
      const [messageResult, blockResult] = await Promise.all([api.messages(conversation.id), api.blocks()]);
      setMessages(messageResult.items);
      setBlocked(Boolean(conversation.peerUserId && blockResult.items.some((item) => item.id === conversation.peerUserId)));
      setActive(conversation);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function toggleBlock() {
    if (!active?.peerUserId || blocking) return;
    const nextBlocked = !blocked;
    setBlocking(true);
    try {
      if (nextBlocked) await api.blockUser(active.peerUserId);
      else await api.unblockUser(active.peerUserId);
      setBlocking(false);
      setBlocked(nextBlocked);
    } catch (error) {
      setStatus((error as Error).message);
      setBlocking(false);
    }
  }

  async function send() {
    if (!active || !draft.trim() || blocked) return;
    try {
      const message = await api.sendMessage(active.id, draft.trim());
      setMessages((items) => [...items, message]);
      setDraft('');
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  if (active) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={8}
        style={styles.flex}
        testID="chat-screen"
      >
        <View style={[styles.screen, styles.chatScreen]}>
          <View style={styles.chatHeader}>
            <Pressable accessibilityLabel="返回消息" accessibilityRole="button" hitSlop={8} onPress={() => setActive(null)} style={styles.headerAction}><Text style={styles.back}>‹</Text></Pressable>
            <View style={styles.flex}><Text style={styles.chatTitle}>{active.title}</Text><Text style={styles.chatSubtitle}>{blocked ? '静默拉黑 · 对方不会收到提示' : '已通过平台安全检查'}</Text></View>
            {active.peerUserId ? <Pressable key={blocked ? 'unblock' : 'block'} accessibilityRole="button" accessibilityLabel={blocked ? '解除拉黑' : '静默拉黑'} testID="silent-block" disabled={blocking} onPress={() => void toggleBlock()} style={styles.headerAction}><Text style={[styles.blockText, blocked && { color: theme.accent }]}>{blocking ? '处理中' : blocked ? '解除' : '拉黑'}</Text></Pressable> : null}
          </View>
          <View style={styles.notice}><Text style={styles.noticeText}>不要提前转账；精确集合位置仅向已加入成员开放。</Text></View>
          <FlatList
            data={messages}
            keyExtractor={(message) => message.id}
            renderItem={({ item: message }) => {
            const mine = message.senderId === '11111111-1111-4111-8111-111111111111';
              return <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}><Text style={[styles.bubbleText, mine && styles.bubbleMineText]}>{message.text}</Text></View>;
            }}
            contentContainerStyle={styles.messageList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.flex}
          />
          <View style={styles.composer}>
            <TextInput accessibilityLabel="输入消息" value={draft} onChangeText={setDraft} editable={!blocked} placeholder={blocked ? '已静默拉黑' : '输入消息…'} placeholderTextColor={theme.muted} returnKeyType="send" onSubmitEditing={() => void send()} style={styles.composerInput} />
            <Pressable accessibilityLabel="发送消息" accessibilityRole="button" disabled={blocked} onPress={() => void send()} style={[styles.send, blocked && { opacity: 0.45 }]}><Text style={styles.sendText}>发送</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  const conversationHeader = (
    <>
      <Text style={styles.eyebrow}>关系与沟通</Text>
      <Text style={styles.pageTitle}>消息</Text>
      <View style={styles.socialCard}>
        <View style={styles.socialStat}><Text style={styles.socialNumber}>{social.following}</Text><Text style={styles.socialLabel}>我的关注</Text></View>
        <View style={styles.verticalLine} />
        <View style={styles.socialStat}><Text style={styles.socialNumber}>{social.followers}</Text><Text style={styles.socialLabel}>关注我的</Text></View>
        <View style={styles.verticalLine} />
        <View style={styles.socialStat}><Text style={styles.socialNumber}>0</Text><Text style={styles.socialLabel}>新的关注</Text></View>
      </View>
      <Text style={styles.sectionTitle}>群组与私信</Text>
    </>
  );

  return (
    <FlatList
      contentContainerStyle={styles.screen}
      data={conversations}
      keyExtractor={(conversation) => conversation.id}
      ListHeaderComponent={conversationHeader}
      ListFooterComponent={status ? <Text style={styles.error}>{status}</Text> : null}
      renderItem={({ item: conversation }) => (
        <Pressable accessibilityLabel={`打开${conversation.type === 'direct' ? '私信' : '群聊'}：${conversation.title}`} accessibilityRole="button" testID="conversation-row" onPress={() => void openConversation(conversation)} style={styles.conversation}>
          <View style={[styles.avatar, { backgroundColor: conversation.type === 'direct' ? theme.brand : theme.post }]}><Text style={styles.avatarText}>{conversation.type === 'direct' ? '人' : '组'}</Text></View>
          <View style={styles.flex}><View style={styles.conversationTop}><Text style={styles.conversationTitle}>{conversation.title}</Text><Text style={styles.conversationTime}>{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</Text></View><Text numberOfLines={1} style={styles.conversationPreview}>{conversation.lastMessage || '打开对话'}</Text></View>
        </Pressable>
      )}
      showsVerticalScrollIndicator={false}
      testID="messages-screen"
    />
  );
}

function ProfileScreen({
  theme,
  styles,
  themeKey,
  onTheme,
}: {
  theme: ThemeTokens;
  styles: AppStyles;
  themeKey: ThemeKey;
  onTheme: (key: ThemeKey) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.profile().then((result) => { setProfile(result); setDisplayName(result.displayName); setBio(result.bio); }).catch((error) => setStatus(error.message));
  }, []);

  async function save() {
    try {
      const updated = await api.updateProfile({ displayName, bio });
      setProfile(updated);
      setEditing(false);
      setStatus('资料已保存，会用于活动与搭子匹配');
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={8}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        testID="profile-screen"
      >
      <View style={styles.profileHero}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{profile?.displayName?.slice(0, 1) ?? '我'}</Text><View style={styles.cameraDot}><Text style={styles.cameraDotText}>＋</Text></View></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{profile?.displayName ?? '加载中…'} {profile?.realNameStatus === 'verified' ? '✓' : ''}</Text>
          <Text style={styles.profileMeta}>ID {profile?.publicId} · {profile?.age} 岁 · {profile?.occupation}</Text>
          <Text style={styles.profileBio}>{profile?.bio}</Text>
        </View>
      </View>
      <View style={styles.profileStats}>
        <View><Text style={styles.statNumber}>{profile?.completionPercent ?? 0}%</Text><Text style={styles.statLabel}>资料完整</Text></View>
        <View><Text style={styles.statNumber}>{profile?.attendanceRate ?? 0}%</Text><Text style={styles.statLabel}>到场率</Text></View>
        <View><Text style={styles.statNumber}>{profile?.rating ?? '–'}</Text><Text style={styles.statLabel}>信用评分</Text></View>
      </View>
      <View style={styles.infoCard}>
        <View style={styles.infoHeader}><Text style={styles.sectionTitle}>匹配资料</Text><Pressable accessibilityRole="button" onPress={() => setEditing((value) => !value)}><Text style={styles.editText}>{editing ? '取消' : '编辑'}</Text></Pressable></View>
        {editing ? (
          <><Text style={styles.fieldLabel}>照片</Text><View style={styles.photoSetup}><Text style={styles.photoSetupText}>＋ 添加照片（建议至少 3 张）</Text></View><Text style={styles.fieldLabel}>昵称</Text><TextInput accessibilityLabel="昵称" value={displayName} onChangeText={setDisplayName} style={styles.input} /><Text style={styles.fieldLabel}>自我介绍</Text><TextInput accessibilityLabel="自我介绍" multiline value={bio} onChangeText={setBio} style={styles.textAreaSmall} /><AppButton testID="save-profile" onPress={() => void save()} theme={theme} styles={styles}>保存资料</AppButton></>
        ) : (
          <><View style={styles.tagRow}>{(profile?.extraAttributes?.interests ?? []).map((interest) => <Tag key={interest} theme={theme} styles={styles}>{interest}</Tag>)}</View><Text style={styles.infoLine}>性格　{profile?.personalityLabel ?? '未设置'}</Text><Text style={styles.infoLine}>年龄　{profile?.age ?? '未设置'}</Text><Text style={styles.infoLine}>实名　{profile?.realNameStatus === 'verified' ? '已完成认证' : '待认证'}</Text></>
        )}
      </View>
      <Text style={styles.sectionTitle}>选择界面主题 · 8 套完整方向</Text>
      <View style={styles.themeGrid}>
        {themeEntries.map(([key, tokens]) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`主题 ${tokens.name}`} testID={`theme-${key}`} key={key} onPress={() => onTheme(key)} style={[styles.themeTile, themeKey === key && styles.themeTileActive, { backgroundColor: tokens.background, borderColor: themeKey === key ? theme.brand : tokens.border }]}>
            <View style={styles.swatches}><View style={[styles.swatch, { backgroundColor: tokens.brand }]} /><View style={[styles.swatch, { backgroundColor: tokens.accent }]} /><View style={[styles.swatch, { backgroundColor: tokens.post }]} /></View>
            <Text style={{ color: tokens.text, fontWeight: '700', fontSize: 12 }}>{tokens.name}</Text>
            <Text style={{ color: tokens.muted, fontSize: 10 }}>{tokens.dark ? '深色' : '浅色'} · R{tokens.cardRadius}</Text>
          </Pressable>
        ))}
      </View>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AppContent() {
  const [tab, setTab] = useState<TabKey>('home');
  const [themeKey, setThemeKey] = useState<ThemeKey>(defaultTheme);
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = themes[themeKey];
  const layout = useMemo(() => getMobileLayout(width, height, fontScale), [fontScale, height, width]);
  const styles = useMemo(() => createStyles(theme, layout), [layout, theme]);

  useEffect(() => {
    if (Platform.OS !== 'android' || tab === 'home') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setTab('home');
      return true;
    });
    return () => subscription.remove();
  }, [tab]);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.appRoot}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <View style={styles.phoneShell}>
        <View style={styles.screenHost}>
          {tab === 'home' ? <HomeScreen theme={theme} styles={styles} /> : null}
          {tab === 'match' ? <MatchScreen theme={theme} styles={styles} /> : null}
          {tab === 'publish' ? <PublishScreen theme={theme} styles={styles} /> : null}
          {tab === 'messages' ? <MessagesScreen theme={theme} styles={styles} /> : null}
          {tab === 'profile' ? <ProfileScreen theme={theme} styles={styles} themeKey={themeKey} onTheme={setThemeKey} /> : null}
        </View>
        <View style={[styles.tabBar, { minHeight: 58 + Math.max(insets.bottom, 4), paddingBottom: Math.max(insets.bottom, 4) }]}>
          {tabs.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable accessibilityRole="tab" accessibilityLabel={entry.label} accessibilityState={{ selected: active }} testID={`tab-${entry.key}`} key={entry.key} onPress={() => setTab(entry.key)} style={styles.tab}>
                <Text style={[styles.tabIcon, active && styles.tabActive]}>{entry.icon}</Text>
                <Text numberOfLines={1} style={[styles.tabLabel, active && styles.tabActive]}>{entry.label}</Text>
                {active ? <View style={styles.tabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function createStyles(theme: ThemeTokens, layout: MobileLayout) {
  const radius = theme.cardRadius;
  return StyleSheet.create({
    flex: { flex: 1 },
    appRoot: { flex: 1, backgroundColor: Platform.OS === 'web' ? (theme.dark ? '#030405' : '#DDE3EA') : theme.background },
    phoneShell: { flex: 1, width: '100%', alignSelf: 'center', backgroundColor: theme.background, ...(Platform.OS === 'web' ? { maxWidth: 480, boxShadow: '0 0 55px rgba(0,0,0,.16)' } as never : {}) },
    screenHost: { flex: 1, minHeight: 0 },
    screen: { flexGrow: 1, paddingHorizontal: layout.horizontalPadding, paddingTop: layout.verticalPadding, paddingBottom: 24 },
    eyebrow: { color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 3 },
    brandTitle: { color: theme.text, fontSize: layout.compact ? 28 : 34, lineHeight: layout.compact ? 34 : 40, fontWeight: '900', letterSpacing: -1.5 },
    pageTitle: { color: theme.text, fontSize: layout.compact ? 25 : 28, lineHeight: layout.compact ? 32 : 35, fontWeight: '900', letterSpacing: -1 },
    brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 17 },
    brandCopy: { flex: 1, minWidth: 0 },
    aiBadge: { backgroundColor: theme.brandSoft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: theme.border },
    aiBadgeText: { color: theme.brand, fontWeight: '800', fontSize: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between', marginBottom: 18 },
    safetyPill: { flexShrink: 1, borderColor: theme.border, borderWidth: 1, borderRadius: 99, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: theme.surface },
    safetyText: { color: theme.muted, fontSize: 10, fontWeight: '700' },
    segment: { flexDirection: 'row', backgroundColor: theme.brandSoft, borderRadius: Math.max(5, radius), padding: 4, marginBottom: 14 },
    segmentButton: { flex: 1, minHeight: 44, paddingVertical: 10, borderRadius: Math.max(3, radius - 4), alignItems: 'center', justifyContent: 'center' },
    segmentButtonActive: { backgroundColor: theme.surface, borderWidth: theme.cardRadius < 6 ? 1 : 0, borderColor: theme.text, ...(Platform.OS === 'web' ? { boxShadow: '0 2px 10px rgba(0,0,0,.08)' } as never : { elevation: 2 }) },
    segmentText: { color: theme.muted, fontWeight: '700', fontSize: 13 },
    segmentTextActive: { color: theme.text },
    searchRow: { flexDirection: 'row', gap: 9, marginBottom: 12 },
    searchBox: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 48, paddingHorizontal: layout.compact ? 10 : 14, backgroundColor: theme.surface, borderRadius: Math.max(5, radius), borderColor: theme.border, borderWidth: 1 },
    searchInput: { flex: 1, color: theme.text, paddingVertical: 10, fontSize: 13, outlineStyle: 'none' } as never,
    filterButton: { minHeight: 48, minWidth: 48, paddingHorizontal: layout.compact ? 10 : 14, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.brand, borderRadius: Math.max(5, radius) },
    filterButtonText: { color: theme.dark && theme.brand === '#8EE8FF' ? theme.background : '#FFFFFF', fontSize: 12, fontWeight: '800' },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    legendDot: { height: 7, width: 7, borderRadius: 99 },
    legendText: { color: theme.muted, fontSize: 11 },
    resultCount: { marginLeft: 'auto' },
    listLoader: { marginVertical: 40 },
    feedCard: { overflow: 'hidden', backgroundColor: theme.surface, borderRadius: radius, marginBottom: 14, borderColor: theme.border, borderWidth: 1, borderLeftWidth: 5 },
    cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.brandSoft },
    coverFallback: { alignItems: 'center', justifyContent: 'center' },
    cardContent: { padding: 14 },
    cardMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 8 },
    cardKind: { color: theme.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    cardAuthor: { color: theme.muted, fontSize: 11 },
    cardTitle: { color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
    cardBody: { color: theme.muted, fontSize: 13, lineHeight: 19 },
    cardFoot: { color: theme.muted, fontSize: 11, marginTop: 10 },
    userResult: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'center' },
    userResultImage: { width: 64, height: 64, aspectRatio: undefined, borderRadius: 18 },
    tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
    tag: { borderRadius: 99, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: theme.brandSoft, borderWidth: 1, borderColor: theme.border },
    tagText: { color: theme.text, fontSize: 10, fontWeight: '600' },
    error: { color: '#E54747', backgroundColor: theme.surface, padding: 12, borderRadius: 10, marginVertical: 10 },
    empty: { color: theme.muted, textAlign: 'center', marginTop: 60 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.52)', justifyContent: 'flex-end' },
    sheet: { width: '100%', maxWidth: 480, alignSelf: 'center', overflow: 'hidden', backgroundColor: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%' },
    sheetContent: { paddingHorizontal: layout.horizontalPadding, paddingTop: 14, paddingBottom: 34 },
    sheetHandle: { backgroundColor: theme.border, width: 42, height: 4, borderRadius: 9, alignSelf: 'center', marginBottom: 14 },
    sheetTitle: { color: theme.text, fontWeight: '900', fontSize: 21, marginBottom: 4 },
    fieldLabel: { color: theme.text, fontSize: 12, fontWeight: '800', marginTop: 13, marginBottom: 7 },
    optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choice: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', borderRadius: Math.max(4, radius), backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border },
    choiceActive: { backgroundColor: theme.brand, borderColor: theme.brand },
    choiceText: { color: theme.muted, fontSize: 11, fontWeight: '700' },
    choiceTextActive: { color: theme.dark && theme.brand === '#8EE8FF' ? theme.background : '#FFFFFF' },
    readOnlyField: { backgroundColor: theme.background, borderColor: theme.border, borderWidth: 1, borderRadius: Math.max(5, radius), padding: 12 },
    inputText: { color: theme.text, fontSize: 12 },
    button: { minHeight: 48, backgroundColor: theme.brand, borderRadius: Math.max(5, radius), marginTop: 16, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    buttonSecondary: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.brand },
    buttonText: { color: theme.dark && theme.brand === '#8EE8FF' ? theme.background : '#FFFFFF', fontWeight: '800', fontSize: 14 },
    matchCard: { overflow: 'hidden', borderRadius: Math.max(8, radius), backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    matchImage: { width: '100%', height: undefined, aspectRatio: layout.matchImageAspectRatio, backgroundColor: theme.brandSoft },
    matchGradient: { padding: 17, backgroundColor: theme.surface },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    matchName: { color: theme.text, fontSize: 25, fontWeight: '900' },
    verified: { color: theme.brand, fontSize: 11, fontWeight: '800' },
    matchId: { color: theme.muted, fontSize: 11, marginTop: 5 },
    matchBio: { color: theme.text, fontSize: 13, lineHeight: 19, marginTop: 10 },
    swipeActions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 25, marginTop: 18 },
    circleAction: { height: 58, width: 58, borderRadius: 99, borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
    circleActionSmall: { height: 48, width: 48, borderColor: theme.accent },
    circleIcon: { fontSize: 32, fontWeight: '500' },
    status: { color: theme.brand, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 12 },
    helper: { color: theme.muted, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 12 },
    input: { minHeight: 44, color: theme.text, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: Math.max(5, radius), paddingHorizontal: 12, outlineStyle: 'none' } as never,
    textArea: { minHeight: 112, textAlignVertical: 'top', color: theme.text, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: Math.max(5, radius), padding: 12, lineHeight: 20, outlineStyle: 'none' } as never,
    textAreaSmall: { minHeight: 80, textAlignVertical: 'top', color: theme.text, backgroundColor: theme.background, borderWidth: 1, borderColor: theme.border, borderRadius: Math.max(5, radius), padding: 12 },
    inlineFields: { flexDirection: layout.compact ? 'column' : 'row', gap: layout.compact ? 0 : 10 },
    stepper: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.border, borderRadius: Math.max(5, radius), backgroundColor: theme.surface },
    stepperButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    stepperControl: { color: theme.brand, fontSize: 21, fontWeight: '700' },
    stepperValue: { color: theme.text, fontSize: 14, fontWeight: '800' },
    aiMediaCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, marginTop: 14, borderRadius: Math.max(5, radius), backgroundColor: theme.brandSoft, borderColor: theme.border, borderWidth: 1 },
    aiMediaPreview: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Math.max(3, radius - 4), backgroundColor: theme.surface },
    aiMediaTitle: { color: theme.text, fontWeight: '800', fontSize: 12 },
    aiMediaText: { color: theme.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
    enabledText: { color: theme.brand, fontSize: 10, fontWeight: '900' },
    planCard: { backgroundColor: theme.surface, borderRadius: Math.max(5, radius), borderWidth: 1, borderColor: theme.brand, padding: 13, marginTop: 14 },
    planTitle: { color: theme.brand, fontSize: 13, fontWeight: '900', marginBottom: 8 },
    planLine: { color: theme.text, fontSize: 11, marginBottom: 5 },
    planSafety: { color: theme.muted, fontSize: 10, lineHeight: 15, marginTop: 6 },
    chatScreen: { flex: 1 },
    chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    headerAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    back: { color: theme.text, fontSize: 38, lineHeight: 40 },
    chatTitle: { color: theme.text, fontSize: 18, fontWeight: '900' },
    chatSubtitle: { color: theme.muted, fontSize: 9, marginTop: 2 },
    blockText: { color: '#E54747', fontSize: 11, fontWeight: '800' },
    notice: { backgroundColor: theme.brandSoft, borderRadius: 9, padding: 9, marginBottom: 16 },
    noticeText: { color: theme.muted, fontSize: 9, textAlign: 'center' },
    bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10, marginBottom: 9 },
    bubbleMine: { alignSelf: 'flex-end', backgroundColor: theme.brand, borderBottomRightRadius: 4 },
    bubbleOther: { alignSelf: 'flex-start', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderBottomLeftRadius: 4 },
    bubbleText: { color: theme.text, fontSize: 13, lineHeight: 18 },
    bubbleMineText: { color: theme.dark && theme.brand === '#8EE8FF' ? theme.background : '#FFFFFF' },
    messageList: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 4 },
    composer: { flexDirection: 'row', gap: 8, alignItems: 'center', borderTopWidth: 1, borderColor: theme.border, paddingTop: 10 },
    composerInput: { flex: 1, minHeight: 44, color: theme.text, backgroundColor: theme.surface, borderRadius: 99, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 14, paddingVertical: 10, outlineStyle: 'none' } as never,
    send: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.brand, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 10 },
    sendText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
    socialCard: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: theme.surface, borderRadius: Math.max(5, radius), borderColor: theme.border, borderWidth: 1, paddingVertical: 16, marginTop: 15, marginBottom: 22 },
    socialStat: { alignItems: 'center', flex: 1 },
    socialNumber: { color: theme.text, fontSize: 20, fontWeight: '900' },
    socialLabel: { color: theme.muted, fontSize: 10, marginTop: 3 },
    verticalLine: { width: 1, height: 28, backgroundColor: theme.border },
    sectionTitle: { color: theme.text, fontSize: 15, fontWeight: '900', marginBottom: 10, marginTop: 4 },
    conversation: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: theme.border, paddingVertical: 13 },
    avatar: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#FFFFFF', fontWeight: '900' },
    conversationTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    conversationTitle: { color: theme.text, fontSize: 14, fontWeight: '800' },
    conversationTime: { color: theme.muted, fontSize: 9 },
    conversationPreview: { color: theme.muted, fontSize: 11, marginTop: 5 },
    profileHero: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 18 },
    profileAvatar: { width: 76, height: 76, borderRadius: 26, backgroundColor: theme.brand, alignItems: 'center', justifyContent: 'center' },
    profileAvatarText: { color: theme.dark && theme.brand === '#8EE8FF' ? theme.background : '#FFFFFF', fontSize: 28, fontWeight: '900' },
    cameraDot: { position: 'absolute', right: -4, bottom: -4, width: 25, height: 25, borderRadius: 99, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', borderColor: theme.background, borderWidth: 3 },
    cameraDotText: { color: theme.dark ? theme.background : theme.text, fontSize: 13, fontWeight: '900' },
    profileName: { color: theme.text, fontSize: 21, fontWeight: '900' },
    profileMeta: { color: theme.muted, fontSize: 10, marginTop: 4 },
    profileBio: { color: theme.text, fontSize: 11, lineHeight: 16, marginTop: 7 },
    profileStats: { flexDirection: 'row', justifyContent: 'space-around', padding: 15, backgroundColor: theme.surface, borderRadius: Math.max(5, radius), borderColor: theme.border, borderWidth: 1, marginBottom: 14 },
    statNumber: { color: theme.text, fontSize: 17, fontWeight: '900', textAlign: 'center' },
    statLabel: { color: theme.muted, fontSize: 9, marginTop: 3 },
    infoCard: { backgroundColor: theme.surface, borderRadius: Math.max(5, radius), borderColor: theme.border, borderWidth: 1, padding: 14, marginBottom: 20 },
    infoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    editText: { color: theme.brand, fontWeight: '800', fontSize: 11 },
    infoLine: { color: theme.muted, fontSize: 12, borderTopWidth: 1, borderColor: theme.border, paddingVertical: 10 },
    photoSetup: { borderWidth: 1, borderStyle: 'dashed', borderColor: theme.brand, borderRadius: Math.max(5, radius), padding: 18, alignItems: 'center' },
    photoSetupText: { color: theme.brand, fontSize: 11, fontWeight: '700' },
    themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
    themeTile: { width: layout.themeColumns === 1 ? '100%' : '48%', minHeight: 76, borderWidth: 1, borderRadius: 10, padding: 9, justifyContent: 'space-between' },
    themeTileActive: { borderWidth: 3 },
    swatches: { flexDirection: 'row', gap: 4 },
    swatch: { width: 19, height: 9, borderRadius: 3 },
    tabBar: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: theme.surface, borderTopColor: theme.border, borderTopWidth: 1, ...(Platform.OS === 'web' ? { boxShadow: '0 -8px 24px rgba(0,0,0,.06)' } as never : {}) },
    tab: { flex: 1, minWidth: 44, height: 58, alignItems: 'center', justifyContent: 'center' },
    tabIcon: { color: theme.muted, fontSize: 22, lineHeight: 24 },
    tabLabel: { color: theme.muted, fontSize: 9, marginTop: 4, fontWeight: '600' },
    tabActive: { color: theme.brand, fontWeight: '900' },
    tabIndicator: { position: 'absolute', bottom: 3, height: 3, width: 17, borderRadius: 99, backgroundColor: theme.brand },
  });
}
