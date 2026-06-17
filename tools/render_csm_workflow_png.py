# -*- coding: utf-8 -*-
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 2400, 1350
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs" / "csm-workflow-as-is-vs-to-be.png"
FONT_REG = r"C:\Windows\Fonts\malgun.ttf"
FONT_BOLD = r"C:\Windows\Fonts\malgunbd.ttf"

BG = "#F5F3EF"
PANEL_BG = "#FFFDF9"
LINE = "#D9CFBF"
INK = "#1F2A37"
MUTED = "#667085"
ASIS_BORDER = "#D27C52"
ASIS_FILL = "#FFF4EE"
ASIS_PAIN = "#FFF1EB"
PAIN_TEXT = "#7A2E19"
TOBE_BORDER = "#5477A8"
TOBE_FILL = "#EEF4FB"
TOBE_GREEN = "#F3F8F5"
TOBE_GREEN_BORDER = "#6C9A7F"
SUMMARY_BG = "#F8F6F1"
WHITE = "#FFFFFF"

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)


def font(size: int, bold: bool = False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def text_size(text, f):
    b = d.multiline_textbbox((0, 0), text, font=f, spacing=4)
    return b[2] - b[0], b[3] - b[1]


def wrap_text(text, f, max_width):
    words = text.split(" ")
    lines = []
    cur = ""
    for word in words:
        cand = word if not cur else cur + " " + word
        if text_size(cand, f)[0] <= max_width:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return "\n".join(lines)


def round_rect(x1, y1, x2, y2, fill, outline, width=2, radius=18):
    d.rounded_rectangle((x1, y1, x2, y2), radius=radius, fill=fill, outline=outline, width=width)


def draw_text(x, y, text, f, fill=INK, anchor=None, spacing=6):
    d.multiline_text((x, y), text, font=f, fill=fill, anchor=anchor, spacing=spacing)


def pill(x, y, text, fill, outline, text_fill, f=None, pad_x=16, pad_y=10):
    f = f or font(18, True)
    tw, th = text_size(text, f)
    x2, y2 = x + tw + pad_x * 2, y + th + pad_y * 2
    round_rect(x, y, x2, y2, fill, outline, width=1, radius=999)
    draw_text(x + pad_x, y + pad_y - 1, text, f, text_fill)
    return x2, y2


def box(
    x,
    y,
    w,
    h,
    title,
    body="",
    fill=WHITE,
    outline=LINE,
    title_fill=INK,
    body_fill=MUTED,
):
    round_rect(x, y, x + w, y + h, fill, outline, width=2, radius=18)
    tx = x + 20
    ty = y + 16
    title_f = font(26, True)
    draw_text(tx, ty, title, title_f, title_fill)
    if body:
        body_f = font(18, False)
        wrapped = "\n".join([wrap_text(line, body_f, w - 40) for line in body.split("\n")])
        draw_text(tx, ty + 42, wrapped, body_f, body_fill)


def compact_box(x, y, w, h, title, fill=WHITE, outline=LINE, title_fill=INK, title_size=18):
    round_rect(x, y, x + w, y + h, fill, outline, width=2, radius=16)
    f = font(title_size, True)
    tw, th = text_size(title, f)
    draw_text(x + 18, y + max(4, (h - th) / 2 - 2), title, f, title_fill)


def arrow_down(cx, y1, y2, color, width=5):
    d.line((cx, y1, cx, y2), fill=color, width=width)
    d.polygon([(cx - 10, y2 - 8), (cx + 10, y2 - 8), (cx, y2 + 12)], fill=color)


def arrow_right(x1, y, x2, color, width=4):
    d.line((x1, y, x2, y), fill=color, width=width)
    d.polygon([(x2 - 10, y - 8), (x2 - 10, y + 8), (x2 + 10, y)], fill=color)


def dashed_line(points, color, width=4, dash=14, gap=10):
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        dx, dy = x2 - x1, y2 - y1
        dist = (dx * dx + dy * dy) ** 0.5
        if dist == 0:
            continue
        ux, uy = dx / dist, dy / dist
        pos = 0
        while pos < dist:
            start = pos
            end = min(pos + dash, dist)
            sx, sy = x1 + ux * start, y1 + uy * start
            ex, ey = x1 + ux * end, y1 + uy * end
            d.line((sx, sy, ex, ey), fill=color, width=width)
            pos += dash + gap


def dashed_arrow(points, color, width=4, dash=14, gap=10):
    dashed_line(points, color, width, dash, gap)
    x1, y1 = points[-2]
    x2, y2 = points[-1]
    if abs(x2 - x1) > abs(y2 - y1):
        if x2 > x1:
            head = [(x2, y2), (x2 - 16, y2 - 8), (x2 - 16, y2 + 8)]
        else:
            head = [(x2, y2), (x2 + 16, y2 - 8), (x2 + 16, y2 + 8)]
    else:
        if y2 > y1:
            head = [(x2, y2), (x2 - 8, y2 - 16), (x2 + 8, y2 - 16)]
        else:
            head = [(x2, y2), (x2 - 8, y2 + 16), (x2 + 8, y2 + 16)]
    d.polygon(head, fill=color)


round_rect(36, 30, W - 36, H - 30, "#F8F6F2", "#ECE5D9", width=2, radius=26)
draw_text(80, 70, "CONSULTING WORKFLOW REDESIGN", font(20, True), "#8B7554")
draw_text(80, 108, "보험업계 CSM 분석 업무 재설계", font(48, True), "#17212F")
draw_text(80, 168, "AS-IS vs TO-BE Workflow", font(24, False), MUTED)

lead = (
    "기존에는 공시 탐색, 표 해석, 기준 정렬, 엑셀 재가공, 보고자료 재편집이 사람 중심으로 반복되며 "
    "질문이나 정정공시가 생길 때마다 원문과 엑셀을 다시 오가는 재작업이 컸다. CSM Lens system은 이를 "
    "수집·파싱·정규화·검산·리뷰 파이프라인으로 묶어, 실무자는 수집 노동보다 검토와 해석에 집중하고 "
    "리더와 임원은 검증된 요약을 더 빠르게 활용하게 한다."
)
draw_text(80, 208, wrap_text(lead, font(22), W - 160), font(22), "#445164", spacing=10)

panel_y = 330
panel_h = 670
gap = 30
panel_w = (W - 80 * 2 - gap) // 2
left_x = 80
right_x = left_x + panel_w + gap

round_rect(left_x, panel_y, left_x + panel_w, panel_y + panel_h, "#FFF9F6", LINE, width=2, radius=20)
round_rect(right_x, panel_y, right_x + panel_w, panel_y + panel_h, "#F7FAFD", LINE, width=2, radius=20)

pill(left_x + 24, panel_y + 24, "AS-IS", ASIS_FILL, ASIS_BORDER, ASIS_BORDER, font(18, True), 14, 8)
draw_text(left_x + 24, panel_y + 72, "기존 업무방식", font(34, True), INK)
pill(left_x + panel_w - 260, panel_y + 24, "병목과 재작업 반복", WHITE, LINE, MUTED, font(17, True), 16, 8)

pill(right_x + 24, panel_y + 24, "TO-BE", TOBE_FILL, TOBE_BORDER, TOBE_BORDER, font(18, True), 14, 8)
draw_text(right_x + 24, panel_y + 72, "CSM Lens system 기반", font(34, True), INK)
pill(right_x + panel_w - 270, panel_y + 24, "검산 가능한 파이프라인", WHITE, LINE, MUTED, font(17, True), 16, 8)

pill(left_x + 24, panel_y + 124, "실무자", ASIS_FILL, ASIS_BORDER, ASIS_BORDER, font(16, True), 12, 6)
pill(left_x + 128, panel_y + 124, "검증 / 리뷰", ASIS_PAIN, ASIS_BORDER, PAIN_TEXT, font(16, True), 12, 6)
pill(left_x + 270, panel_y + 124, "리더 / 임원 활용", WHITE, LINE, "#475467", font(16, True), 12, 6)

pill(right_x + 24, panel_y + 124, "실무자", TOBE_GREEN, TOBE_GREEN_BORDER, "#2F5D42", font(16, True), 12, 6)
pill(right_x + 128, panel_y + 124, "CSM Lens system", TOBE_FILL, TOBE_BORDER, TOBE_BORDER, font(16, True), 12, 6)
pill(right_x + 292, panel_y + 124, "리더 / 임원 활용", TOBE_GREEN, TOBE_GREEN_BORDER, "#2F5D42", font(16, True), 12, 6)

lx = left_x + 24
ly = panel_y + 174
step_w = 690
step_h = 74
call_x = left_x + 760
call_w = 260
left_steps = [
    ("공시 탐색", "사업·반기·분기보고서 수기 검색", "공시 위치 탐색 시간 과다"),
    ("CSM 주석 수기 확인", "표 위치 직접 탐색", "보험사별 표 구조 상이"),
    ("보험사별 표 해석", "단위·기준·재보험 제외 여부 수기 정렬", "단위 / 기준 혼선"),
    ("엑셀 재가공", "표준화 · 증감분 계산 · Peer 비교표 작성", "엑셀 재가공 반복"),
    ("보고자료 재편집", "표와 문구를 별도 재작성", "보고자료용 재편집"),
    ("질문 대응 재확인", "원문 공시와 엑셀 재확인", "출처 추적 어려움"),
]
left_centers = []
for i, (title, body, callout) in enumerate(left_steps):
    y = ly + i * 86
    box(
        lx,
        y,
        step_w,
        step_h,
        title,
        body,
        fill=WHITE if i != 5 else ASIS_PAIN,
        outline=ASIS_BORDER if i == 5 else LINE,
        title_fill=INK if i != 5 else PAIN_TEXT,
        body_fill=MUTED if i != 5 else PAIN_TEXT,
    )
    cy = y + step_h / 2
    left_centers.append(cy)
    if i < len(left_steps) - 1:
        arrow_down(lx + step_w / 2, y + step_h, y + 86 - 12, "#9C7A65", 4)
    box(
        call_x,
        y + 10,
        call_w,
        54,
        callout,
        "",
        fill=ASIS_FILL if i < 5 else ASIS_PAIN,
        outline=ASIS_BORDER,
        title_fill=ASIS_BORDER if i < 5 else PAIN_TEXT,
    )
    arrow_right(lx + step_w + 8, cy, call_x - 16, "#CBA28E", 3)

loop_color = "#C95F38"
dashed_arrow(
    [
        (lx + step_w / 2, left_centers[5] + 30),
        (lx + step_w / 2 + 150, left_centers[5] + 30),
        (lx + step_w / 2 + 150, left_centers[3]),
        (lx + step_w / 2 + 6, left_centers[3]),
    ],
    loop_color,
    4,
    14,
    10,
)
draw_text(lx + step_w / 2 + 164, left_centers[4] - 20, "질문 / 오류", font(16, True), loop_color)

b2x, b2y = left_x + 52, panel_y + panel_h - 82
box(b2x, b2y, 300, 56, "정정공시 / 기준 혼선 발생", "", fill=ASIS_PAIN, outline=ASIS_BORDER, title_fill=PAIN_TEXT)
dashed_arrow(
    [
        (b2x + 150, b2y),
        (b2x + 150, b2y - 36),
        (lx + 120, b2y - 36),
        (lx + 120, left_centers[2] + 8),
    ],
    loop_color,
    4,
    14,
    10,
)

rx = right_x + 24
ry = panel_y + 160
box(rx, ry, 360, 58, "회사·분기 선택", "실행 대상 지정", fill=TOBE_GREEN, outline=TOBE_GREEN_BORDER, title_fill="#214634", body_fill="#4B6358")
arrow_down(rx + 180, ry + 58, ry + 86, "#6687B0", 4)

sys_x, sys_y, sys_w, sys_h = right_x + 24, ry + 96, panel_w - 48, 255
round_rect(sys_x, sys_y, sys_x + sys_w, sys_y + sys_h, "#EFF5FB", TOBE_BORDER, width=2, radius=18)
pill(sys_x + 18, sys_y + 16, "CSM Lens system", WHITE, TOBE_BORDER, TOBE_BORDER, font(16, True), 12, 6)

sys_steps = [
    ("Open DART 수집", "", "자동 수집"),
    ("CSM 후보 표 탐지", "", "자동 탐지"),
    ("Movement 표준 매핑", "", "표준 매핑"),
    ("검산 규칙 적용", "", "검산"),
    ("휴먼리뷰 큐 분리", "", "리뷰 큐"),
]
ssx = sys_x + 24
ssy = sys_y + 58
ssw = 640
ssh = 34
for i, (title, body, badge) in enumerate(sys_steps):
    y = ssy + i * 39
    compact_box(ssx, y, ssw, ssh, title, fill=WHITE, outline=LINE, title_fill=INK, title_size=18)
    if i < len(sys_steps) - 1:
        arrow_down(ssx + ssw / 2, y + ssh, y + 39 - 8, "#6E8BB0", 3)
    compact_box(
        sys_x + sys_w - 210,
        y + 2,
        170,
        34,
        badge,
        fill="#F7FBFF" if i < 3 else "#F3F8F5",
        outline=TOBE_BORDER if i < 4 else TOBE_GREEN_BORDER,
        title_fill=TOBE_BORDER if i < 4 else "#2F5D42",
        title_size=16,
    )

compact_box(
    sys_x + 24,
    sys_y + sys_h - 50,
    sys_w - 48,
    34,
    "검증된 Snapshot 생성",
    fill=TOBE_FILL,
    outline=TOBE_BORDER,
    title_fill=TOBE_BORDER,
    title_size=18,
)
arrow_down(sys_x + sys_w / 2, sys_y + sys_h, sys_y + sys_h + 28, "#6687B0", 4)

out_y = sys_y + sys_h + 38
box(rx, out_y, panel_w - 48, 62, "대시보드 / 시장 비교 / 전망 / AI 해설", "같은 기준의 결과를 바로 활용", fill=TOBE_GREEN, outline=TOBE_GREEN_BORDER, title_fill="#214634", body_fill="#4B6358")
box(rx, out_y + 72, panel_w - 48, 38, "검증된 요약 활용 · 경고 신호와 차이 원인 빠른 파악", "", fill=WHITE, outline=LINE, title_fill=INK, body_fill=MUTED)

sum_y = 1025
round_rect(80, sum_y, W - 80, H - 70, SUMMARY_BG, LINE, width=2, radius=18)
draw_text(108, sum_y + 24, "업무 재설계 비교 요약", font(30, True), INK)

col1 = 260
col2 = 920
col3 = 920
start_x = 108
start_y = sum_y + 82
rows = [
    ("사람의 역할", "수집·정리·가공·보고자료 작성 대부분 수작업", "예외 검토, 해석, 휴먼리뷰, 보고 메시지 정교화 중심"),
    ("반복작업량", "공시 탐색과 엑셀 재가공 반복", "자동 수집·탐지·매핑으로 반복작업 대폭 축소"),
    ("재작업 발생지점", "질문·오류·정정공시 때 앞 단계 전체를 다시 손봄", "검산과 휴먼리뷰 단계로 재작업을 국소화"),
    ("출처 추적성", "원문과 엑셀을 다시 오가며 수기 확인", "공시 링크, 기준, 검산상태가 결과물에 함께 남음"),
    ("검증 가능성", "사람 기억과 개별 파일 관리에 의존", "규칙 검산 + 휴먼리뷰 기반의 신뢰 가능한 흐름"),
    ("보고 대응 속도", "보고자료 재편집 후 질문 대응에 시간 소요", "대시보드 / 비교 / 전망 / AI 해설로 즉시 대응"),
]
for x, w, label in [
    (start_x, col1, "비교 항목"),
    (start_x + col1 + 10, col2, "AS-IS"),
    (start_x + col1 + col2 + 20, col3, "TO-BE"),
]:
    round_rect(x, start_y, x + w, start_y + 42, WHITE, LINE, width=1, radius=12)
    draw_text(x + 16, start_y + 10, label, font(18, True), "#344054")

body_y = start_y + 52
for i, (a, b, c) in enumerate(rows):
    y = body_y + i * 42
    for x, w, text in [
        (start_x, col1, a),
        (start_x + col1 + 10, col2, b),
        (start_x + col1 + col2 + 20, col3, c),
    ]:
        round_rect(x, y, x + w, y + 36, WHITE, LINE, width=1, radius=10)
        f = font(16, True) if x == start_x else font(16, False)
        fill = INK if x == start_x else "#475467"
        draw_text(x + 14, y + 8, wrap_text(text, f, w - 28), f, fill)

img.save(OUT, "PNG", optimize=True)
print(OUT)
