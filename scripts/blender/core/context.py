"""Strict data-only job validation and isolated per-asset generation context."""
from dataclasses import dataclass
import math
import random
import re

import bpy

from core.materials import PALETTE_ROLES, create_palette


GENERATOR_VERSION = "2.1.0"
BLENDER_VERSION = "5.2.2"
ID_PATTERN = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
TYPE_PARAMETERS = {
    "roadblock": {"width": (0.3, 6), "height": (0.2, 3), "depth": (0.2, 4)},
    "traffic-cone": {"height": (0.3, 3), "baseSize": (0.1, 2), "segments": (8, 16)},
    "street-lamp": {"height": (2, 12), "armLength": (0.2, 3), "baseSize": (0.2, 1.5)},
    "building": {"width": (1, 20), "height": (2, 60), "depth": (1, 20),
                 "floors": (1, 16), "windowsPerFloor": (1, 8)},
    "billboard": {"width": (0.8, 4), "height": (2, 6), "depth": (0.2, 1)},
    "character": {"height": (1.65, 1.8)},
    "powerup": {"width": (.3, 1), "height": (.3, 1), "depth": (.12, .4)},
}
THEME_ROLES = {role for aliases in PALETTE_ROLES.values() for role in aliases.values()}


def require_object(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_keys(value, required, optional, label):
    require_object(value, label)
    missing = set(required) - set(value)
    unknown = set(value) - set(required) - set(optional)
    if missing or unknown:
        raise ValueError(f"{label}: missing keys {sorted(missing)}, unknown keys {sorted(unknown)}")


def number(value, minimum, maximum, label, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if integer and (not isinstance(value, int)):
        raise ValueError(f"{label} must be an integer")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} must be in [{minimum}, {maximum}]")


def identifier(value, label):
    if not isinstance(value, str) or len(value) > 64 or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase kebab-case id, maximum 64 characters")


def validate_theme(theme):
    require_keys(theme, {"id", "shading", "materials", "scene"}, set(), "job.theme")
    identifier(theme["id"], "job.theme.id")
    if theme["shading"] != "flat":
        raise ValueError("job.theme.shading must be flat")
    require_keys(theme["materials"], THEME_ROLES, set(), "job.theme.materials")
    for role, material in theme["materials"].items():
        label = f"job.theme.materials.{role}"
        require_keys(material, {"color", "roughness", "metalness"},
                     {"emissive", "emissiveStrength"}, label)
        for key in ("color", "emissive"):
            if key in material and (not isinstance(material[key], str)
                                    or not COLOR_PATTERN.fullmatch(material[key])):
                raise ValueError(f"{label}.{key} must be #RRGGBB")
        for key in ("roughness", "metalness"):
            number(material[key], 0, 1, f"{label}.{key}")
        if ("emissive" in material) != ("emissiveStrength" in material):
            raise ValueError(f"{label}: emissive and emissiveStrength must appear together")
        if "emissiveStrength" in material:
            number(material["emissiveStrength"], 0, 1, f"{label}.emissiveStrength")
    require_keys(theme["scene"], {"road", "background", "coin", "keyLight"}, set(), "job.theme.scene")
    if any(not isinstance(value, str) or not COLOR_PATTERN.fullmatch(value)
           for value in theme["scene"].values()):
        raise ValueError("job.theme.scene colours must be #RRGGBB")


def validate_asset(asset, index):
    label = f"job.assets[{index}]"
    require_object(asset, label)
    asset_type = asset.get("type")
    if not isinstance(asset_type, str) or asset_type not in TYPE_PARAMETERS:
        raise ValueError(f"{label}.type is not a registered generator")
    parameters = TYPE_PARAMETERS[asset_type]
    required = {"id", "type", "themeId", "dimensions", "materials", "maxTriangles", "maxBytes", "tolerance", "assetSeed"}
    required.update(parameters)
    if asset_type == "building":
        required.update({"variant", "roofStyle", "accentStyle"})
    if asset_type == "street-lamp":
        required.add("style")
    if asset_type == "character":
        required.update({"generator", "proportions", "outfit", "accessories"})
    if asset_type == "powerup":
        required.update({"generator", "variant"})
    require_keys(asset, required, {"theme"}, label)
    identifier(asset["id"], f"{label}.id")
    identifier(asset["themeId"], f"{label}.themeId")
    if "theme" in asset:
        identifier(asset["theme"], f"{label}.theme")
        if asset["theme"] != asset["themeId"]:
            raise ValueError(f"{label}.theme must match resolved themeId")
    for parameter, bounds in parameters.items():
        number(asset[parameter], bounds[0], bounds[1], f"{label}.{parameter}",
               integer=parameter in {"segments", "floors", "windowsPerFloor"})
    if asset_type == "building":
        if asset["variant"] not in {"residential", "office"}:
            raise ValueError(f"{label}.variant must be residential or office")
        if asset["floors"] * asset["windowsPerFloor"] > 96:
            raise ValueError(f"{label}: floors × windowsPerFloor must not exceed 96")
        if asset["roofStyle"] not in {"flat", "equipment", "terrace"}:
            raise ValueError(f"{label}.roofStyle is not supported")
        if asset["accentStyle"] not in {"plain", "neon"}:
            raise ValueError(f"{label}.accentStyle is not supported")
    if asset_type == "street-lamp" and asset["style"] not in {"classic", "tech"}:
        raise ValueError(f"{label}.style is not supported")
    if asset_type == "powerup":
        if asset["generator"] != "pickup-icon-v1":
            raise ValueError(f"{label}.generator must be pickup-icon-v1")
        if asset["variant"] not in {"magnet", "shield", "double-score"}:
            raise ValueError(f"{label}.variant is not supported")
    if asset_type == "character":
        if asset["generator"] != "humanoid-runner":
            raise ValueError(f"{label}.generator must be humanoid-runner")
        require_keys(asset["proportions"], {"headScale", "shoulderWidth", "legLengthRatio"}, set(),
                     f"{label}.proportions")
        for key, minimum, maximum in (("headScale", 1, 1.2), ("shoulderWidth", .44, .56),
                                      ("legLengthRatio", .43, .49)):
            number(asset["proportions"][key], minimum, maximum, f"{label}.proportions.{key}")
        require_keys(asset["outfit"], {"jacketColor", "pantsColor", "shoeColor", "skinColor"},
                     set(), f"{label}.outfit")
        if any(not isinstance(value, str) or not COLOR_PATTERN.fullmatch(value)
               for value in asset["outfit"].values()):
            raise ValueError(f"{label}.outfit colors must be #RRGGBB")
        require_keys(asset["accessories"], {"backpack"}, set(), f"{label}.accessories")
        if not isinstance(asset["accessories"]["backpack"], bool):
            raise ValueError(f"{label}.accessories.backpack must be boolean")
        scale = asset["height"] / 1.75
        dimensions = [asset["proportions"]["shoulderWidth"] + .24 * scale,
                      asset["height"], .5 * scale]
    elif asset_type in {"roadblock", "building", "billboard", "powerup"}:
        dimensions = [asset["width"], asset["height"], asset["depth"]]
    elif asset_type == "traffic-cone":
        dimensions = [asset["baseSize"], asset["height"], asset["baseSize"]]
    else:
        dimensions = [asset["armLength"] + asset["baseSize"], asset["height"], asset["baseSize"]]
    if not isinstance(asset["dimensions"], list) or len(asset["dimensions"]) != 3:
        raise ValueError(f"{label}.dimensions must be glTF [width, height, depth]")
    for axis, (actual, expected) in enumerate(zip(asset["dimensions"], dimensions, strict=True)):
        number(actual, 0.001, 100, f"{label}.dimensions[{axis}]")
        if abs(actual - expected) > 1e-9:
            raise ValueError(f"{label}.dimensions does not match type parameters")
    prefix = asset["id"].replace("-", "_")
    aliases = ("jacket", "pants", "shoe", "skin") if asset_type == "character" else PALETTE_ROLES[asset_type]
    material_names = [f"{prefix}_{alias}" for alias in aliases]
    if asset["materials"] != material_names:
        raise ValueError(f"{label}.materials must match generator palette {material_names}")
    number(asset["assetSeed"], 0, 0xffffffff, f"{label}.assetSeed", integer=True)
    number(asset["maxTriangles"], 1, 3500 if asset_type == "character" else 3000,
           f"{label}.maxTriangles", integer=True)
    number(asset["maxBytes"], 1024, 1024 * 1024, f"{label}.maxBytes", integer=True)
    number(asset["tolerance"], 1e-6, 0.005, f"{label}.tolerance")


def validate_job(job):
    require_keys(job, {"schemaVersion", "generatorVersion", "blenderVersion", "themes", "seed", "assets"},
                 set(), "job")
    if job["schemaVersion"] != 1 or isinstance(job["schemaVersion"], bool):
        raise ValueError("job.schemaVersion must be 1")
    if job["generatorVersion"] != GENERATOR_VERSION:
        raise ValueError(f"job.generatorVersion must be {GENERATOR_VERSION}")
    if job["blenderVersion"] != BLENDER_VERSION:
        raise ValueError(f"job.blenderVersion must be pinned to {BLENDER_VERSION}")
    if bpy.app.version != tuple(int(part) for part in BLENDER_VERSION.split(".")):
        raise RuntimeError(f"Expected Blender {BLENDER_VERSION}, found {bpy.app.version_string}")
    number(job["seed"], 0, 0xffffffff, "job.seed", integer=True)
    require_object(job["themes"], "job.themes")
    if not 1 <= len(job["themes"]) <= 64:
        raise ValueError("job.themes must contain 1..64 themes")
    for theme_id, theme in job["themes"].items():
        validate_theme(theme)
        if theme_id != theme["id"]:
            raise ValueError("job.themes keys must match theme.id")
    if not isinstance(job["assets"], list) or not 1 <= len(job["assets"]) <= 64:
        raise ValueError("job.assets must contain between 1 and 64 assets")
    seen = set()
    for index, asset in enumerate(job["assets"]):
        validate_asset(asset, index)
        if asset["themeId"] not in job["themes"]:
            raise ValueError(f"Unknown resolved theme {asset['themeId']}")
        if asset["id"] in seen:
            raise ValueError(f"Duplicate resource id {asset['id']}")
        seen.add(asset["id"])


def reset_scene():
    """Prevent names, materials and previous assets leaking between batch entries."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.armatures,
                       bpy.data.cameras, bpy.data.lights, bpy.data.actions):
        for datablock in list(collection):
            collection.remove(datablock)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.context.scene.cursor.location = (0, 0, 0)


@dataclass(frozen=True)
class GenerationContext:
    asset: dict
    theme: dict
    rng: random.Random
    palette: dict

    @property
    def prefix(self):
        return self.asset["id"].replace("-", "_")

    @classmethod
    def create(cls, asset, theme):
        # No global random state: --only and reordered assets preserve this asset.
        return cls(asset, theme, random.Random(asset["assetSeed"]), create_palette(asset, theme))
