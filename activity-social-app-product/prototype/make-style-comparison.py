from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
STYLES = [
    ("blue", "清透蓝", "信任 / 清晰", "#0A84FF"),
    ("teal", "极光青", "科技 / 社区", "#00A9B7"),
    ("coral", "日出橙", "热情 / 行动", "#FF694A"),
    ("midnight", "午夜红", "夜间 / 沉浸", "#FF304B"),
    ("clash", "电光撞色", "年轻 / 海报", "#713CFF"),
    ("cobalt", "钴蓝波普", "编辑 / 秩序", "#1746E0"),
    ("forest", "森林米白", "松弛 / 户外", "#145F46"),
    ("mono", "黑灰冰蓝", "高端 / 工具", "#8EE8FF"),
]


def font(size):
    for path in ["/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def mask(size, radius):
    result = Image.new("L", size, 0)
    ImageDraw.Draw(result).rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return result


def main():
    phone_w, phone_h = 195, 422
    cols, rows = 4, 2
    gap_x, gap_y, margin = 60, 82, 56
    header = 104
    width = margin * 2 + cols * phone_w + (cols - 1) * gap_x
    height = header + rows * (phone_h + 56) + (rows - 1) * gap_y + 30
    canvas = Image.new("RGB", (width, height), "#F1F3F6")
    draw = ImageDraw.Draw(canvas)
    draw.text((margin, 28), "DAZZZZZZZZZ · 8 套视觉与界面逻辑", font=font(30), fill="#171A1F")
    draw.text((margin, 70), "相同功能，不同品牌性格与信息组织方式", font=font(15), fill="#68717B")
    for index, (key, name, logic, color) in enumerate(STYLES):
        row, col = divmod(index, cols)
        x = margin + col * (phone_w + gap_x)
        y = header + row * (phone_h + 56 + gap_y)
        source = Image.open(ROOT / "screens" / key / "home.png").convert("RGB")
        source = source.resize((phone_w, phone_h), Image.Resampling.LANCZOS)
        shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((x + 5, y + 8, x + phone_w + 5, y + phone_h + 8), radius=18, fill=(20, 28, 38, 35))
        canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
        canvas.paste(source, (x, y), mask(source.size, 18))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((x, y + phone_h + 18, x + 24, y + phone_h + 24), radius=3, fill=color)
        draw.text((x + 33, y + phone_h + 9), name, font=font(17), fill="#24292F")
        draw.text((x + 33, y + phone_h + 33), logic, font=font(12), fill="#707982")
    canvas.convert("RGB").save(ROOT / "contact-sheets" / "style-comparison.png", quality=95)


if __name__ == "__main__":
    main()
