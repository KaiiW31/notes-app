from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\Law Kai Wei\Downloads\Notes Icon.png")
OUT_DIR = ROOT / "public" / "icons"
PNG_OUT = OUT_DIR / "notes-icon.png"
ICO_OUT = OUT_DIR / "notes-icon.ico"


def is_background(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, _ = pixel
    return r > 238 and g > 238 and b > 238 and abs(r - g) < 10 and abs(g - b) < 10


def remove_edge_background(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    for x in range(width):
      queue.append((x, 0))
      queue.append((x, height - 1))
    for y in range(height):
      queue.append((0, y))
      queue.append((width - 1, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or x < 0 or y < 0 or x >= width or y >= height:
            continue
        seen.add((x, y))

        if not is_background(pixels[x, y]):
            continue

        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)

    canvas = Image.new("RGBA", (1024, 1024), (255, 255, 255, 0))
    image.thumbnail((936, 936), Image.Resampling.LANCZOS)
    x = (1024 - image.width) // 2
    y = (1024 - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    return canvas


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    icon = remove_edge_background(Image.open(SOURCE))
    icon.save(PNG_OUT)
    icon.save(
        ICO_OUT,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(PNG_OUT)
    print(ICO_OUT)


if __name__ == "__main__":
    main()
