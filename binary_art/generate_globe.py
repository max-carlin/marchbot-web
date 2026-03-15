#!/usr/bin/env python3
"""Generate a self-contained HTML file with a rotating ASCII globe animated via pure CSS."""

import math
import html

# --- Configuration ---
COLS = 80
ROWS = 40
NUM_FRAMES = 60
ANIMATION_DURATION_S = 6
SPHERE_RADIUS = 0.95

# --- Continent outlines as (lat, lon) polygon vertices ---
# Simplified but recognizable coastlines for each major landmass

CONTINENT_POLYGONS = [
    # North America (mainland) - clockwise from Pacific NW
    [(60,-140),(58,-137),(56,-133),(53,-131),(50,-128),(48,-124),(44,-124),
     (40,-124),(37,-122),(34,-120),(32,-117),(30,-116),(28,-115),(25,-112),
     (23,-110),(20,-105),(18,-100),(16,-96),(14,-92),(12,-87),(10,-84),
     (9,-80),(8,-77),(9,-76),(11,-80),(13,-83),(15,-84),(17,-88),(19,-88),
     (21,-87),(22,-85),(25,-81),(27,-80),(30,-81),(32,-81),(33,-79),
     (35,-76),(37,-76),(39,-74),(41,-72),(43,-70),(44,-67),(45,-63),
     (47,-60),(49,-55),(51,-56),(53,-56),(55,-59),(57,-62),(59,-64),
     (62,-66),(65,-63),(68,-58),(70,-56),(72,-57),(75,-60),(77,-68),
     (80,-65),(82,-63),(83,-69),(83,-75),(82,-85),(80,-90),(76,-88),
     (73,-82),(70,-83),(68,-90),(66,-95),(64,-96),(62,-95),(60,-96),
     (57,-100),(55,-108),(55,-115),(56,-122),(57,-130),(58,-136),
     (60,-142),(62,-149),(64,-160),(66,-166),(64,-168),(62,-166),
     (60,-162),(59,-155),(58,-149),(57,-139),(56,-133),(60,-140)],

    # Greenland
    [(60,-44),(62,-42),(65,-38),(68,-30),(70,-25),(72,-22),(75,-18),
     (78,-18),(80,-20),(82,-27),(83,-32),(83,-42),(82,-48),(80,-58),
     (78,-68),(76,-70),(74,-58),(72,-54),(70,-50),(68,-46),(65,-44),
     (62,-45),(60,-44)],

    # South America
    [(12,-72),(11,-74),(10,-76),(8,-77),(5,-77),(3,-78),(1,-80),
     (-2,-80),(-4,-81),(-6,-80),(-8,-79),(-10,-78),(-13,-77),
     (-15,-76),(-17,-73),(-18,-70),(-20,-64),(-22,-60),(-24,-58),
     (-26,-56),(-28,-54),(-30,-52),(-32,-52),(-34,-54),(-36,-57),
     (-38,-58),(-40,-62),(-42,-64),(-44,-66),(-46,-68),(-48,-70),
     (-50,-72),(-52,-70),(-54,-68),(-55,-66),(-54,-64),(-52,-68),
     (-49,-66),(-46,-66),(-42,-62),(-38,-57),(-34,-52),(-30,-49),
     (-26,-46),(-22,-41),(-18,-39),(-14,-38),(-10,-37),(-7,-35),
     (-4,-34),(-2,-44),(0,-50),(2,-53),(4,-58),(6,-61),(8,-63),
     (9,-67),(10,-70),(12,-72)],

    # Africa
    [(37,-10),(36,-6),(36,-2),(35,0),(34,-1),(33,-2),(32,-5),(31,-8),
     (30,-10),(28,-13),(26,-15),(24,-16),(22,-17),(20,-17),(18,-16),
     (16,-16),(14,-17),(12,-16),(10,-15),(8,-13),(6,-10),(5,-8),
     (5,-5),(4,-3),(4,0),(5,2),(5,7),(4,9),(3,10),(1,9),(0,9),
     (-1,9),(-2,11),(-4,12),(-6,12),(-8,14),(-10,16),(-11,18),
     (-13,20),(-15,22),(-17,25),(-19,28),(-21,30),(-23,30),
     (-25,32),(-27,33),(-29,32),(-31,30),(-33,28),(-34,26),
     (-35,20),(-34,18),(-32,18),(-30,17),(-28,16),(-25,15),
     (-22,14),(-18,12),(-14,13),(-10,14),(-8,14),(-5,12),
     (-3,10),(-1,10),(0,10),(2,10),(5,10),(8,10),(10,10),
     (10,15),(11,22),(12,30),(12,42),(11,44),(10,46),(11,48),
     (12,50),(14,48),(16,46),(18,44),(20,42),(22,40),(24,38),
     (26,36),(28,35),(30,34),(32,33),(33,33),(35,12),(36,10),
     (37,10),(37,-10)],

    # Europe (mainland)
    [(36,-6),(37,0),(38,-1),(40,-4),(41,-4),(42,-3),(43,-8),(44,-8),
     (44,-2),(46,-2),(47,-2),(48,-5),(49,-2),(50,0),(51,2),(52,5),
     (53,6),(54,8),(55,8),(56,9),(57,10),(58,12),(60,5),(61,5),
     (63,6),(65,12),(67,14),(68,16),(70,19),(71,25),(71,28),
     (70,30),(69,32),(67,28),(65,26),(63,30),(60,28),(57,24),
     (56,22),(55,21),(54,18),(54,14),(52,14),(51,13),(50,12),
     (49,8),(48,7),(47,7),(46,6),(45,7),(44,8),(44,12),(43,13),
     (42,15),(41,16),(40,18),(39,20),(38,24),(37,22),(36,15),
     (36,12),(36,-6)],

    # British Isles
    [(50,-6),(51,-5),(52,-4),(53,-3),(54,-3),(55,-5),(56,-5),
     (57,-6),(58,-5),(59,-3),(58,0),(57,1),(56,0),(55,0),
     (54,-1),(53,0),(52,1),(51,1),(50,0),(50,-6)],

    # Scandinavia/Finland
    [(56,12),(58,12),(60,12),(62,10),(64,14),(66,14),(68,16),
     (70,20),(71,26),(70,28),(68,28),(66,26),(64,28),(62,30),
     (60,28),(58,18),(57,16),(56,14),(56,12)],

    # Russia / Northern Asia
    [(70,30),(72,40),(72,50),(73,55),(72,60),(71,68),(72,80),
     (72,100),(72,110),(72,120),(72,130),(72,140),(70,140),
     (68,142),(66,140),(64,143),(62,150),(60,155),(58,158),
     (56,162),(54,158),(52,155),(50,143),(48,140),(46,138),
     (44,136),(43,132),(42,131),(40,130),(42,128),(44,130),
     (46,130),(48,128),(50,128),(50,120),(48,118),(46,116),
     (44,112),(42,110),(40,108),(38,106),(36,104),(34,106),
     (32,104),(30,104),(28,108),(26,110),(24,110),(22,108),
     (20,106),(18,106),(20,100),(22,96),(24,92),(26,88),
     (28,84),(30,80),(32,76),(34,72),(36,68),(38,62),
     (40,56),(40,48),(38,44),(36,40),(35,36),(36,36),
     (38,36),(40,40),(42,42),(44,40),(46,38),(48,36),
     (50,32),(52,30),(55,28),(58,28),(60,30),(65,30),
     (68,32),(70,30)],

    # East Asia (China, Korea, Japan area)
    [(54,110),(52,110),(50,116),(48,118),(46,118),(44,116),
     (42,112),(40,110),(38,108),(36,106),(34,108),(32,110),
     (30,112),(28,114),(26,116),(24,114),(22,110),(20,108),
     (18,106),(16,108),(14,109),(12,108),(10,106),(8,104),
     (6,102),(4,100),(2,98),(4,96),(6,98),(8,100),
     (10,102),(12,104),(14,106),(16,108),(18,108),(20,110),
     (22,112),(24,115),(26,118),(28,120),(30,122),(32,122),
     (34,124),(35,126),(36,127),(38,128),(40,130),(42,131),
     (44,132),(46,134),(48,136),(50,138),(52,135),(54,130),
     (56,125),(56,118),(54,110)],

    # Middle East / Arabian Peninsula
    [(32,33),(34,36),(36,36),(38,44),(40,48),(38,50),(36,52),
     (34,56),(32,56),(30,52),(28,50),(26,50),(24,50),(22,50),
     (20,48),(18,45),(16,43),(14,44),(12,44),(12,42),(14,42),
     (16,40),(18,38),(20,36),(22,36),(24,38),(26,38),(28,36),
     (30,34),(32,33)],

    # India
    [(35,72),(34,74),(32,76),(30,78),(28,78),(26,80),(24,82),
     (22,82),(20,80),(18,78),(16,76),(14,76),(12,78),(10,78),
     (8,77),(8,74),(10,74),(12,74),(14,73),(16,73),(18,73),
     (20,72),(22,70),(24,68),(26,68),(28,66),(30,66),(32,66),
     (34,68),(35,72)],

    # Central Asia (Iran, Afghanistan, Pakistan etc)
    [(40,48),(38,50),(36,52),(34,56),(32,58),(30,60),(28,62),
     (26,64),(24,66),(26,68),(28,68),(30,68),(32,68),(34,70),
     (36,68),(38,62),(40,56),(40,48)],

    # Japan
    [(31,131),(33,130),(35,132),(36,134),(37,136),(38,137),
     (39,138),(40,140),(42,141),(43,142),(44,144),(45,142),
     (44,140),(42,140),(40,139),(38,136),(36,134),(34,132),
     (32,131),(31,131)],

    # Southeast Asian islands / Indonesia
    [(6,106),(5,104),(3,104),(1,104),(0,104),(-1,104),(-2,106),
     (-3,108),(-4,108),(-5,106),(-6,106),(-7,107),(-8,110),
     (-8,114),(-7,116),(-6,116),(-5,115),(-4,116),(-3,114),
     (-2,112),(-1,110),(0,108),(2,106),(4,105),(6,106)],

    # Borneo
    [(7,117),(6,116),(4,115),(2,112),(1,110),(0,110),(-1,110),
     (-2,111),(-3,112),(-4,116),(-3,118),(-1,118),(1,118),
     (3,118),(5,118),(7,117)],

    # Papua New Guinea
    [(-2,132),(-3,134),(-4,136),(-5,142),(-6,148),(-8,148),
     (-9,146),(-8,142),(-7,140),(-6,138),(-5,136),(-4,134),
     (-3,132),(-2,130),(-1,132),(-2,132)],

    # Australia
    [(-12,130),(-13,132),(-14,136),(-15,140),(-16,141),
     (-18,140),(-20,139),(-22,138),(-24,136),(-26,134),
     (-28,132),(-30,130),(-32,128),(-34,127),(-35,118),
     (-34,116),(-32,115),(-30,115),(-28,114),(-26,113),
     (-24,114),(-22,114),(-20,116),(-18,118),(-16,123),
     (-14,126),(-13,128),(-12,130)],

    # Australia - eastern coast bump
    [(-12,130),(-14,136),(-16,141),(-18,146),(-20,148),
     (-22,150),(-24,152),(-26,153),(-28,154),(-30,153),
     (-32,152),(-34,151),(-36,150),(-38,148),(-38,146),
     (-36,146),(-34,148),(-32,150),(-30,152),(-28,153),
     (-26,152),(-24,150),(-22,148),(-20,146),(-18,144),
     (-16,142),(-14,138),(-12,130)],

    # New Zealand (North Island)
    [(-35,173),(-36,175),(-37,176),(-38,178),(-39,177),
     (-40,176),(-41,175),(-42,174),(-41,172),(-39,174),
     (-37,175),(-36,174),(-35,173)],

    # New Zealand (South Island)
    [(-42,170),(-43,171),(-44,172),(-45,170),(-46,168),
     (-47,167),(-46,166),(-44,168),(-43,170),(-42,170)],

    # Madagascar
    [(-12,49),(-14,48),(-16,47),(-18,44),(-20,44),(-22,44),
     (-24,45),(-25,47),(-24,48),(-22,48),(-20,49),(-18,50),
     (-16,50),(-14,50),(-12,49)],

    # Iceland
    [(63,-24),(64,-22),(65,-18),(66,-16),(66,-20),(65,-22),
     (64,-24),(63,-24)],

    # Antarctica
    [(-65,-60),(-67,-60),(-70,-65),(-72,-70),(-75,-80),
     (-78,-90),(-80,-100),(-82,-120),(-83,-140),(-84,-160),
     (-85,-180),(-85,180),(-84,160),(-83,140),(-82,120),
     (-80,100),(-78,80),(-76,60),(-74,40),(-72,20),
     (-70,0),(-68,-20),(-67,-40),(-65,-60)],

    # Sri Lanka
    [(10,80),(9,80),(8,80),(7,80),(6,80),(6,81),(7,82),
     (8,82),(9,81),(10,80)],

    # Philippines
    [(18,120),(16,120),(14,121),(12,122),(10,124),(8,126),
     (7,126),(8,124),(10,122),(12,121),(14,120),(16,118),
     (18,118),(19,120),(18,120)],

    # Taiwan
    [(25,121),(24,120),(23,120),(22,121),(23,122),(24,122),(25,121)],

    # Central America / Mexico detail
    [(32,-117),(30,-115),(28,-114),(26,-112),(24,-110),(22,-106),
     (20,-105),(18,-100),(16,-96),(15,-92),(14,-90),(13,-88),
     (12,-86),(10,-84),(9,-80),(8,-77),(7,-78),(8,-80),(9,-83),
     (10,-85),(11,-86),(12,-87),(14,-88),(15,-90),(14,-92),
     (15,-84),(18,-88),(19,-88),(21,-87),(23,-86),(25,-81),
     (26,-80),(28,-82),(30,-84),(31,-90),(30,-96),(28,-98),
     (26,-100),(24,-104),(26,-106),(28,-108),(30,-110),(32,-117)],

    # Cuba
    [(23,-84),(22,-84),(21,-80),(20,-77),(20,-75),(21,-75),
     (22,-78),(23,-80),(23,-84)],

    # Kamchatka Peninsula
    [(51,156),(53,158),(55,160),(57,162),(59,163),(60,162),
     (61,163),(62,165),(60,166),(58,163),(56,161),(54,159),
     (52,158),(51,156)],
]

# --- Pre-rasterize continents to a high-res grid ---
MAP_LAT_RES = 1  # degrees per cell
MAP_LON_RES = 1
MAP_ROWS = 180  # -90 to 89
MAP_COLS = 360  # -180 to 179


def point_in_polygon(lat, lon, polygon):
    """Ray casting algorithm for point-in-polygon test."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-10) + xi):
            inside = not inside
        j = i
    return inside


def build_land_map():
    """Rasterize continent polygons onto a high-res grid."""
    land = [[False] * MAP_COLS for _ in range(MAP_ROWS)]

    for poly in CONTINENT_POLYGONS:
        # Find bounding box for efficiency
        lats = [p[0] for p in poly]
        lons = [p[1] for p in poly]
        min_lat = max(int(min(lats)) - 1, -90)
        max_lat = min(int(max(lats)) + 1, 89)
        min_lon = max(int(min(lons)) - 1, -180)
        max_lon = min(int(max(lons)) + 1, 179)

        for lat_i in range(min_lat, max_lat + 1):
            row = 90 - lat_i  # row 0 = 90N, row 179 = 89S
            if row < 0 or row >= MAP_ROWS:
                continue
            for lon_i in range(min_lon, max_lon + 1):
                col = (lon_i + 180) % MAP_COLS
                if point_in_polygon(lat_i + 0.5, lon_i + 0.5, poly):
                    land[row][col] = True

    return land


print("Building continent map...")
LAND_MAP = build_land_map()
print("Continent map built.")


def is_land(lat_deg, lon_deg):
    """Check if a lat/lon coordinate is land using the pre-rasterized map."""
    row = int(90 - lat_deg)
    row = max(0, min(MAP_ROWS - 1, row))
    col = int(lon_deg + 180) % MAP_COLS
    col = max(0, min(MAP_COLS - 1, col))
    return LAND_MAP[row][col]


def render_frame(rotation_angle):
    """Render a single frame of the globe at the given Y-rotation angle (radians)."""
    lines = []
    aspect_ratio = 2.2  # chars are roughly 2.2x taller than wide in monospace

    for row in range(ROWS):
        line = []
        for col in range(COLS):
            # Map to normalized coordinates centered on screen
            nx = (col - COLS / 2) / (COLS / 2)
            ny = -(row - ROWS / 2) / (ROWS / 2)

            # Scale and adjust for aspect ratio
            sx = nx * 1.1 / (1.0 / aspect_ratio * 2.0)
            sy = ny * 1.1

            # Check if point is on sphere
            r2 = sx * sx + sy * sy
            if r2 > SPHERE_RADIUS * SPHERE_RADIUS:
                line.append(' ')
                continue

            # Calculate z (front of sphere)
            z = math.sqrt(SPHERE_RADIUS * SPHERE_RADIUS - r2)

            # Rotate point around Y axis (inverse rotation to get original lat/lon)
            cos_a = math.cos(-rotation_angle)
            sin_a = math.sin(-rotation_angle)
            rx = sx * cos_a + z * sin_a
            rz = -sx * sin_a + z * cos_a

            # Convert to lat/lon
            lat = math.degrees(math.asin(max(-1, min(1, sy / SPHERE_RADIUS))))
            lon = math.degrees(math.atan2(rx, rz))

            # Lighting: dot product with light direction (slightly off to the right and up)
            light_x, light_y, light_z = 0.3, 0.3, 0.9
            light_len = math.sqrt(light_x**2 + light_y**2 + light_z**2)
            light_x /= light_len; light_y /= light_len; light_z /= light_len
            # Normal at sphere surface = (sx, sy, z) / R
            nx_n = sx / SPHERE_RADIUS
            ny_n = sy / SPHERE_RADIUS
            nz_n = z / SPHERE_RADIUS
            brightness = max(0, nx_n * light_x + ny_n * light_y + nz_n * light_z)

            # Determine if land or ocean
            land = is_land(lat, lon)

            if land:
                # Land: ALWAYS dense 0s and 1s - never empty
                ch = '1' if (col + row) % 2 == 0 else '0'
            else:
                # Ocean: moderate density with 0s and 1s
                if brightness > 0.5:
                    if (col * 7 + row * 13) % 3 == 0:
                        ch = '1' if (col + row) % 2 == 0 else '0'
                    else:
                        ch = ' '
                elif brightness > 0.2:
                    if (col * 7 + row * 13) % 4 == 0:
                        ch = '0' if (col + row) % 2 == 0 else '1'
                    else:
                        ch = ' '
                else:
                    if (col * 7 + row * 13) % 6 == 0:
                        ch = '.'
                    else:
                        ch = ' '

            line.append(ch)
        lines.append(''.join(line).rstrip())

    return '\n'.join(lines)


def generate_html():
    """Generate the complete HTML file with all frames."""
    frames = []
    for i in range(NUM_FRAMES):
        angle = (2 * math.pi * i) / NUM_FRAMES
        frame_text = render_frame(angle)
        frames.append(frame_text)
        if (i + 1) % 10 == 0:
            print(f"  Rendered frame {i + 1}/{NUM_FRAMES}")

    # Build HTML
    frame_duration = ANIMATION_DURATION_S / NUM_FRAMES
    visibility_pct = 100.0 / NUM_FRAMES

    parts = []
    parts.append(f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ASCII Rotating Globe</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    background: #0a0a1a;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    overflow: hidden;
  }}
  .globe-container {{
    position: relative;
    font-family: 'Courier New', Courier, monospace;
    font-size: 14px;
    line-height: 1.15;
    color: #4466cc;
    white-space: pre;
  }}
  .frame {{
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
  }}
  .frame:first-child {{
    position: relative;
  }}
""")

    for i in range(NUM_FRAMES):
        delay = frame_duration * i
        parts.append(f"""  .frame:nth-child({i + 1}) {{
    animation: show {ANIMATION_DURATION_S}s step-end infinite;
    animation-delay: {delay:.4f}s;
  }}
""")

    parts.append(f"""  @keyframes show {{
    0% {{ opacity: 1; }}
    {visibility_pct:.4f}% {{ opacity: 0; }}
    100% {{ opacity: 0; }}
  }}
""")

    parts.append("""</style>
</head>
<body>
<div class="globe-container">
""")

    for frame in frames:
        escaped = html.escape(frame)
        parts.append(f'<pre class="frame">{escaped}</pre>\n')

    parts.append("""</div>
</body>
</html>
""")

    return ''.join(parts)


if __name__ == '__main__':
    print("Generating ASCII globe...")
    html_content = generate_html()
    with open('globe.html', 'w') as f:
        f.write(html_content)
    print(f"Done! Generated globe.html ({len(html_content)} bytes)")
