"""Original texture-free pickup icons, additive pickup-icon-v1 (1.0.0).

Coordinates and dimensions follow the existing factory contract. All geometry is
authored in Blender X/Z, extruded along Y and exported with the existing single
Y-up conversion. Glyphs are native polygon strokes, independent of fonts/UI.
"""
from math import hypot

from core.geometry import box, join_parts, mesh_object


GENERATOR_VERSION = "1.0.0"


def prism(context, name, points, near, far, material):
    """Extrude a normalized X/Z polygon; positive winding faces Blender -Y."""
    width, height, depth = (context.asset[key] for key in ("width", "height", "depth"))
    points = list(points)
    area = sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(points, points[1:]+points[:1]))
    if area < 0:
        points.reverse()
    count = len(points)
    vertices = [(x*width, y*depth, z*height) for y in (near, far) for x, z in points]
    faces = [tuple(range(count)), tuple(reversed(range(count, 2*count)))]
    faces.extend((i, (i+1) % count, (i+1) % count+count, i+count) for i in range(count))
    return mesh_object(f"{context.prefix}_{name}", vertices, faces, [material])


def scaled(points, scale):
    return [(x*scale, .5+(z-.5)*scale) for x, z in points]


def stroke(context, name, start, end, thickness, near, far, material):
    dx, dz = end[0]-start[0], end[1]-start[1]
    length = hypot(dx, dz)
    ox, oz = -dz/length*thickness/2, dx/length*thickness/2
    points = [(start[0]+ox, start[1]+oz), (start[0]-ox, start[1]-oz),
              (end[0]-ox, end[1]-oz), (end[0]+ox, end[1]+oz)]
    return prism(context, name, points, near, far, material)


def magnet(context):
    palette = context.palette
    # The open U and pale pole tips distinguish this pickup from circular coins.
    outline = [(-.5, .78), (-.5, .34), (-.42, .13), (-.22, 0), (.22, 0),
               (.42, .13), (.5, .34), (.5, .78), (.28, .78), (.28, .36),
               (.20, .24), (-.20, .24), (-.28, .36), (-.28, .78)]
    parts = [prism(context, "u_body", outline, -.5, .5, palette["body"])]
    for side in (-1, 1):
        for name, z, height, material in (("pole", .91, .18, "accent"), ("band", .80, .04, "mark")):
            parts.append(box(f"{context.prefix}_{name}_{side}",
                             (side*.39*context.asset["width"], 0, z*context.asset["height"]),
                             (.22*context.asset["width"], context.asset["depth"],
                              height*context.asset["height"]), palette[material]))
    return parts


def shield(context):
    palette = context.palette
    outline = [(-.5, .84), (-.34, 1), (.34, 1), (.5, .84), (.42, .33), (0, 0), (-.42, .33)]
    # Two raised insets remain readable as the pickup rotates, with no lights.
    inset = scaled(outline, .82)
    crest = [(-.055, .28), (-.055, .54), (-.20, .54), (-.20, .65),
             (-.055, .65), (-.055, .81), (.055, .81), (.055, .65),
             (.20, .65), (.20, .54), (.055, .54), (.055, .28)]
    # Keep the entire depth exactly within [-.5, .5]. Recess the body first;
    # separate surface polygons avoid coplanar z-fighting and transparent shells.
    parts = [prism(context, "shield_rim", outline, -.42, .42, palette["accent"])]
    for side in (-1, 1):
        a, b = sorted((side*.42, side*.46))
        parts.append(prism(context, f"shield_face_{side}", inset, a, b, palette["body"]))
        a, b = sorted((side*.46, side*.5))
        parts.append(prism(context, f"shield_crest_{side}", crest, a, b, palette["mark"]))
    return parts


def double_score(context):
    palette = context.palette
    outline = [(-.5, .2), (-.3, 0), (.3, 0), (.5, .2), (.5, .8),
               (.3, 1), (-.3, 1), (-.5, .8)]
    parts = [prism(context, "badge", outline, -.36, .36, palette["body"])]
    two = [((-.32, .73), (-.08, .73)), ((-.08, .73), (-.08, .50)),
           ((-.32, .50), (-.08, .50)), ((-.32, .50), (-.32, .27)),
           ((-.32, .27), (-.08, .27))]
    cross = [((.08, .36), (.32, .64)), ((.08, .64), (.32, .36))]
    for side in (-1, 1):
        a, b = sorted((side*.36, side*.40))
        parts.append(prism(context, f"gold_rim_{side}", scaled(outline, .93), a, b, palette["accent"]))
        a, b = sorted((side*.40, side*.44))
        parts.append(prism(context, f"inset_{side}", scaled(outline, .81), a, b, palette["body"]))
        a, b = sorted((side*.44, side*.50))
        # Mirror back X so the literal 2x reads correctly from both sides.
        for index, (start, end) in enumerate(two+cross):
            start = (start[0]*(-side), start[1])
            end = (end[0]*(-side), end[1])
            parts.append(stroke(context, f"glyph_{side}_{index}", start, end, .065,
                                a, b, palette["mark"]))
    return parts


VARIANTS = {"magnet": magnet, "shield": shield, "double-score": double_score}


def generate(context):
    return join_parts(VARIANTS[context.asset["variant"]](context), context.prefix)
