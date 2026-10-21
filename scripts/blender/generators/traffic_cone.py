"""Flat polygonal safety cone with two white warning bands."""
from core.geometry import box, join_parts, ring_mesh


def generate(context):
    asset, palette, name = context.asset, context.palette, context.prefix
    height, base = asset["height"], asset["baseSize"]
    base_height = height * 0.09
    parts = [box(f"{name}_foot", (0, 0, base_height / 2),
                 (base, base, base_height), palette["base"],
                 bevel=min(base * 0.035, base_height * 0.2))]
    # Shared rings have no internal caps, avoiding duplicated hidden faces.
    levels = (0.09, 0.36, 0.47, 0.62, 0.73, 1.0)
    def radius(level):
        return base * (0.41 + (0.045 - 0.41) * (level - 0.09) / 0.91)
    rings = [(height * level, radius(level)) for level in levels]
    parts.append(ring_mesh(f"{name}_cone", rings, asset["segments"],
                           [palette["orange"], palette["white"]], [0, 1, 0, 1, 0]))
    return join_parts(parts, name)
