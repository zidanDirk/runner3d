"""Texture-free, two-sided luminous wayfinding sign on a grounded support."""
from core.geometry import box, join_parts, mesh_object


def generate(context):
    asset, palette, name = context.asset, context.palette, context.prefix
    width, height, depth = asset["width"], asset["height"], asset["depth"]
    panel_height = height * 0.43
    bottom = height - panel_height
    parts = [
        box(f"{name}_foot", (0, 0, height * 0.025), (width * 0.42, depth, height * 0.05), palette["frame"]),
        box(f"{name}_mast", (0, 0, bottom / 2), (width * 0.085, depth * 0.45, bottom), palette["frame"]),
        box(f"{name}_panel", (0, 0, bottom + panel_height / 2), (width, depth * 0.62, panel_height), palette["frame"]),
    ]
    # Four cyan border segments and a magenta chevron, on both faces.
    for face in (-1, 1):
        y = face * depth * 0.325
        for side in (-1, 1):
            parts.append(box(f"{name}_border_h_{face}_{side}",
                             (0, y, bottom + panel_height / 2 + side * panel_height * 0.43),
                             (width * 0.9, depth * 0.035, panel_height * 0.035), palette["cyan"]))
            parts.append(box(f"{name}_border_v_{face}_{side}",
                             (side * width * 0.44, y, bottom + panel_height / 2),
                             (width * 0.025, depth * 0.035, panel_height * 0.86), palette["cyan"]))
        points = [(-.24, -.27), (.02, -.27), (.31, 0), (.02, .27), (-.24, .27), (.05, 0)]
        vertices = [(x * width, y + face * depth * 0.025, bottom + panel_height * (.5 + z)) for x, z in points]
        # Explicit triangles avoid concave polygon triangulation ambiguity.
        triangles = [(0, 1, 5), (1, 2, 5), (2, 3, 5), (3, 4, 5)]
        faces = triangles if face < 0 else [tuple(reversed(triangle)) for triangle in triangles]
        parts.append(mesh_object(f"{name}_arrow_{face}", vertices, faces, [palette["magenta"]]))
    return join_parts(parts, name)
