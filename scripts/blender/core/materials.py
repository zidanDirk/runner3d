"""Texture-free, theme-owned PBR palettes shared by every asset generator."""
import bpy


PALETTE_ROLES = {
    "roadblock": {"orange": "warning", "white": "light", "base": "base"},
    "traffic-cone": {"orange": "warning", "white": "light", "base": "base"},
    "street-lamp": {"metal": "metal", "base": "base", "lamp": "lamp"},
    "building": {"body": "building", "trim": "buildingAccent", "window": "window",
                 "warm_window": "warmWindow"},
    "billboard": {"frame": "base", "cyan": "window", "magenta": "warmWindow"},
    "powerup": {"body": "base", "accent": "lamp", "mark": "light"},
}


def srgb_channel(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def linear_color(hex_color):
    """Theme uses display sRGB; Blender Principled stores linear colour."""
    return tuple(srgb_channel(int(hex_color[index:index + 2], 16) / 255)
                 for index in (1, 3, 5)) + (1.0,)


def material(name, definition):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    if shader is None:
        raise RuntimeError("Blender Principled BSDF node unavailable")
    required = {"Base Color", "Roughness", "Metallic", "Emission Color", "Emission Strength"}
    missing = required - set(shader.inputs.keys())
    if missing:
        raise RuntimeError(f"Blender {bpy.app.version_string}: missing Principled inputs {sorted(missing)}")
    color = linear_color(definition["color"])
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = definition["roughness"]
    shader.inputs["Metallic"].default_value = definition["metalness"]
    if "emissive" in definition:
        # Strength <=1 stays in core glTF emissiveFactor, without a decoder/extension.
        shader.inputs["Emission Color"].default_value = linear_color(definition["emissive"])
        shader.inputs["Emission Strength"].default_value = definition["emissiveStrength"]
    result.diffuse_color = color
    return result


def create_palette(asset, theme):
    prefix = asset["id"].replace("-", "_")
    if asset["type"] == "powerup":
        # Semantic pickup colors stay recognizable in Dusk and Neon lighting;
        # no new theme roles or changes to existing generated material hashes.
        colors = {"magnet": ("#DF4054", "#FFD36B", "#FFF5DF"),
                  "shield": ("#126A89", "#50E2F2", "#E5FCFF"),
                  "double-score": ("#6550B9", "#FFD36B", "#FFF5DF")}[asset["variant"]]
        return {role: material(f"{prefix}_{role}", {"color": color,
                         "roughness": .62 if role == "body" else .42,
                         "metalness": .15 if role == "accent" else 0})
                for role, color in zip(("body", "accent", "mark"), colors, strict=True)}
    if asset["type"] == "character":
        # Character clothing stays readable across both cities. Four explicitly
        # configured shared materials also cover hair, face details and backpack.
        roles = {"jacket": ("jacketColor", .82), "pants": ("pantsColor", .88),
                 "shoe": ("shoeColor", .75), "skin": ("skinColor", .85)}
        return {alias: material(f"{prefix}_{alias}", {"color": asset["outfit"][key],
                                                     "roughness": roughness, "metalness": 0})
                for alias, (key, roughness) in roles.items()}
    return {alias: material(f"{prefix}_{alias}", theme["materials"][role])
            for alias, role in PALETTE_ROLES[asset["type"]].items()}
