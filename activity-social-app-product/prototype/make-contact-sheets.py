from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SCREENS = [
    ("home", "首页"),
    ("match", "搭子"),
    ("publish", "发布"),
    ("messages", "消息"),
    ("profile", "我的"),
]
THEMES = {
    "blue": ("清透蓝 · Clear Blue", "#0A84FF"),
    "teal": ("极光青 · Aurora Teal", "#00A9B7"),
    "coral": ("日出橙 · Sunrise Coral", "#FF694A"),
    "midnight": ("午夜红 · Midnight Red", "#FF304B"),
    "clash": ("电光撞色 · Electric Clash", "#713CFF"),
    "cobalt": ("钴蓝波普 · Cobalt Pop", "#1746E0"),
    "forest": ("森林米白 · Forest Cream", "#145F46"),
    "mono": ("黑灰冰蓝 · Mono Ice", "#8EE8FF"),
}

FONT_PATHS = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/SFNS.ttf",
]


def font(size: int):
    for candidate in FONT_PATHS:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def main():
    out_dir = ROOT / "contact-sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    scale = 0.52
    phone_w, phone_h = int(390 * scale), int(844 * scale)
    gap, side, header_h, label_h, bottom = 24, 46, 112, 38, 46
    canvas_w = side * 2 + phone_w * len(SCREENS) + gap * (len(SCREENS) - 1)
    canvas_h = header_h + phone_h + label_h + bottom
    for key, (title, color) in THEMES.items():
        canvas = Image.new("RGB", (canvas_w, canvas_h), "#F2F4F7")
        draw = ImageDraw.Draw(canvas)
        draw.text((side, 34), title, font=font(30), fill="#16191D")
        draw.rounded_rectangle((side, 78, side + 72, 85), radius=4, fill=color)
        draw.text((canvas_w - side - 250, 42), "DAZZZZZZZZZ Mobile UI System", font=font(15), fill="#6B727A")
        for idx, (screen, label) in enumerate(SCREENS):
            source = Image.open(ROOT / "screens" / key / f"{screen}.png").convert("RGB")
            source = source.resize((phone_w, phone_h), Image.Resampling.LANCZOS)
            x = side + idx * (phone_w + gap)
            y = header_h
            shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            sd = ImageDraw.Draw(shadow)
            sd.rounded_rectangle((x + 4, y + 8, x + phone_w + 4, y + phone_h + 8), radius=18, fill=(25, 35, 45, 32))
            canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
            canvas.paste(source, (x, y), rounded_mask(source.size, 18))
            draw = ImageDraw.Draw(canvas)
            box = draw.textbbox((0, 0), label, font=font(16))
            draw.text((x + (phone_w - (box[2] - box[0])) / 2, y + phone_h + 15), label, font=font(16), fill="#3C4248")
        canvas.convert("RGB").save(out_dir / f"{key}.png", quality=94)


if __name__ == "__main__":
    main()
