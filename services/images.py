import io

from PIL import Image, UnidentifiedImageError


def normalize_reference(data):
    if not data or len(data) > 3_000_000:
        raise ValueError("Choose a reference image smaller than 3 MB.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 8_000_000:
                raise ValueError("Reference image exceeds 8 million pixels.")
            image.load()
            rgba = image.convert("RGBA")
            background = Image.new("RGB", image.size, "white")
            background.paste(rgba, mask=rgba.getchannel("A"))
            background.thumbnail((1024, 1024))
            output = io.BytesIO()
            background.save(output, "JPEG", quality=90)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Reference must be a valid image.") from exc

