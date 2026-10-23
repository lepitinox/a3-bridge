# A3 Bridge 1.0.0 : protocole

_Généré depuis les tableaux de `design/` par `tools/build.py`._

Passerelle locale : `http://127.0.0.1:8765` et `ws://127.0.0.1:8765` (port réglable).

## Ordres

Chaque ordre s'envoie en `POST /command` avec `{"cmd": "<nom>", "args": {...}}`, ou en WebSocket avec `{"type": "command", "id": <votre id>, "cmd": "<nom>", "args": {...}}`.

### `spawn_unit`

Crée un soldat (IA) à une position. Il rejoint un groupe existant ou un nouveau groupe du camp choisi.

Renvoie : `id`, `group`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `type` | unit_class | oui | Classe du soldat, par ex. B_Soldier_F. Exemples : `B_Soldier_F`, `B_Soldier_TL_F`, `B_medic_F`, `B_soldier_AR_F`, `O_Soldier_F`, `O_Soldier_SL_F`, `I_Soldier_F`, `C_man_1` |
| `pos` | position | oui | Position d'apparition. |
| `side` | side | non (défaut `"west"`) | Camp du nouveau groupe (ignoré si group est donné). |
| `group` | entity_id | non (défaut `"none"`) | Groupe à rejoindre ; none = nouveau groupe. |
| `dir` | number | non (défaut `0`) | Orientation en degrés (0 = nord). |
| `skill` | ratio | non (défaut `0.5`) | Compétence de l'IA entre 0 et 1. |

### `spawn_vehicle`

Crée un véhicule à une position, vide ou avec son équipage IA.

Renvoie : `id`, `crew`, `group`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `type` | vehicle_class | oui | Classe du véhicule, par ex. B_MRAP_01_F. Exemples : `B_MRAP_01_F`, `B_MRAP_01_hmg_F`, `B_APC_Wheeled_01_cannon_F`, `B_Heli_Light_01_F`, `O_MRAP_02_F`, `O_APC_Tracked_02_cannon_F`, `I_MRAP_03_F`, `C_Offroad_01_F` |
| `pos` | position | oui | Position d'apparition. |
| `dir` | number | non (défaut `0`) | Orientation en degrés. |
| `crew` | boolean | non (défaut `false`) | true = crée aussi l'équipage IA. |
| `side` | side_or_default | non (défaut `"default"`) | Camp de l'équipage ; default = camp prévu pour ce véhicule. |

### `spawn_object`

Crée un objet (caisse, sac de sable, etc.) à une position. Il apparaît ensuite dans la liste des objets du flux d'état.

Renvoie : `id`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `type` | object_class | oui | Classe de l'objet, par ex. Box_NATO_Ammo_F. Exemples : `Box_NATO_Ammo_F`, `Box_East_Ammo_F`, `Land_BagFence_Long_F`, `Land_HBarrier_5_F`, `Land_CampingTable_F`, `Land_Cargo_Patrol_V1_F` |
| `pos` | position | oui | Position. |
| `dir` | number | non (défaut `0`) | Orientation en degrés. |

### `delete`

Supprime une unité, un véhicule (avec son équipage), un objet ou un groupe entier.

Renvoie : `id`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Identifiant de l'unité, du véhicule, de l'objet ou du groupe. |

### `move`

Ordonne à une unité ou à un groupe de se rendre à une position (à pied ou en véhicule), comme un vrai ordre de déplacement.

Renvoie : `id`, `group`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Unité ou groupe à déplacer. |
| `pos` | position | oui | Destination. |

### `teleport`

Déplace instantanément une unité, un véhicule, un objet ou un groupe à une position.

Renvoie : `id`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Unité, véhicule, objet ou groupe. |
| `pos` | position | oui | Nouvelle position. |
| `dir` | number | non (défaut `-1`) | Nouvelle orientation en degrés ; -1 = inchangée. |

### `set_behaviour`

Change le comportement, la règle de tir, la vitesse, la formation et la posture d'un groupe (ou du groupe d'une unité).

Renvoie : `group`, `behaviour`, `combat_mode`, `speed_mode`, `formation`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe, ou unité (son groupe sera modifié). |
| `behaviour` | behaviour | non (défaut `"unchanged"`) | Comportement. |
| `combat_mode` | combat_mode | non (défaut `"unchanged"`) | Règle de tir. |
| `speed_mode` | speed_mode | non (défaut `"unchanged"`) | Vitesse. |
| `formation` | formation | non (défaut `"unchanged"`) | Formation. |
| `stance` | stance | non (défaut `"unchanged"`) | Posture imposée à tous les soldats du groupe. |

### `set_health`

Fixe la santé d'une unité, d'un véhicule ou d'un objet : 1 = intact (soigne), 0 = détruit (tue).

Renvoie : `id`, `health`, `alive`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Unité, véhicule ou objet. |
| `health` | ratio | oui | 1 = intact, 0 = mort ou détruit. |

### `message`

Affiche un message à l'écran des joueurs (tous ou un camp).

Renvoie : `delivered_to`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `text` | string | oui | Texte du message. Exemples : `Contact au nord !`, `Bienvenue sur le serveur de test` |
| `kind` | message_kind | non (défaut `"system"`) | Forme du message. |
| `to` | audience | non (défaut `"all"`) | Destinataires. |
| `sender` | string | non (défaut `"HQ"`) | Expéditeur affiché (radio et sous-titre). Exemples : `HQ`, `Commandant IA`, `Overlord` |

### `set_environment`

Change l'heure et la météo. Les paramètres laissés à -1 ne changent pas.

Renvoie : `daytime`, `overcast`, `rain`, `fog`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `time` | hours | non (défaut `-1`) | Heure du jour (0-24), -1 = inchangée. |
| `overcast` | keep_or_ratio | non (défaut `-1`) | Couverture nuageuse 0-1, -1 = inchangée. |
| `rain` | keep_or_ratio | non (défaut `-1`) | Pluie 0-1 (nécessite des nuages), -1 = inchangée. |
| `fog` | keep_or_ratio | non (défaut `-1`) | Brouillard 0-1, -1 = inchangé. |
| `transition` | number | non (défaut `0`) | Durée de transition de la météo en secondes ; 0 = immédiat. |

### `spawn_group`

Fait apparaître un groupe officiel du jeu (escouade, équipe, peloton, convoi) en formation, avec ses véhicules.

Renvoie : `group`, `units`, `vehicles`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `group` | group_path | oui | Groupe officiel à faire apparaître. Exemples : `West/BLU_F/Infantry/BUS_InfSquad`, `West/BLU_F/Infantry/BUS_InfTeam`, `West/BLU_F/Motorized/BUS_MotInf_Team`, `East/OPF_F/Infantry/OIA_InfSquad`, `East/OPF_F/Mechanized/OIA_MechInfSquad`, `Indep/IND_F/Infantry/HAF_InfSquad` |
| `pos` | position | oui | Position du chef ; les autres se placent en formation autour. |
| `dir` | number | non (défaut `0`) | Orientation du groupe en degrés. |
| `side` | side_or_default | non (défaut `"default"`) | Camp ; default = camp prévu par le groupe. |

### `spawn_effect`

Fait apparaître un effet ou une munition à une position : tir d'artillerie ou de mortier, bombe, roquettes, grenade, fumigène, écran de fumée, fusée éclairante, mine ou IED. Plusieurs coups possibles, avec dispersion et délai.

Renvoie : `effect`, `count`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `effect` | effect | oui | Effet ou munition à faire apparaître. |
| `pos` | position | oui | Point visé (au sol). |
| `count` | count | non (défaut `1`) | Nombre de coups. |
| `spread` | metres | non (défaut `0`) | Dispersion autour du point visé, en mètres. |
| `delay` | seconds | non (défaut `1`) | Délai entre deux coups, en secondes. |

### `set_marker`

Crée un marqueur sur la carte des joueurs, ou modifie un marqueur existant du même nom (icône, couleur, texte, zone rectangulaire ou elliptique).

Renvoie : `name`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `name` | marker_name | non (défaut `"auto"`) | Nom du marqueur à créer ou à modifier ; auto = nouveau marqueur. |
| `pos` | position | oui | Position du marqueur. |
| `text` | string | non (défaut `"none"`) | Texte affiché à côté du marqueur (none = aucun). |
| `type` | marker_type | non (défaut `"mil_dot"`) | Icône (formes icon seulement). Exemples : `mil_dot`, `mil_objective`, `mil_warning`, `mil_destroy`, `mil_flag`, `mil_marker`, `hd_flag`, `hd_objective` |
| `color` | marker_color | non (défaut `"ColorBlack"`) | Couleur. Exemples : `ColorBlack`, `ColorRed`, `ColorBlue`, `ColorGreen`, `ColorYellow`, `ColorOrange`, `ColorWhite`, `ColorBLUFOR`, `ColorOPFOR`, `ColorIndependent` |
| `shape` | marker_shape | non (défaut `"icon"`) | Forme : icône, rectangle ou ellipse. |
| `size_x` | number | non (défaut `1`) | Taille : échelle de l'icône, ou demi-largeur de la zone en mètres. |
| `size_y` | number | non (défaut `1`) | Taille : échelle de l'icône, ou demi-hauteur de la zone en mètres. |
| `dir` | number | non (défaut `0`) | Orientation en degrés. |
| `alpha` | ratio | non (défaut `1`) | Opacité entre 0 et 1. |

### `delete_marker`

Supprime un marqueur de la carte des joueurs.

Renvoie : `name`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `name` | marker_name | oui | Nom du marqueur à supprimer. |

### `add_waypoint`

Ajoute un point de passage à un groupe (aller, chercher et détruire, garder, tenir, monter ou descendre d'un véhicule, débarquer, boucle de patrouille...), à la suite des autres ou en remplaçant le plan en cours.

Renvoie : `group`, `index`, `waypoints`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe, ou unité (son groupe recevra le point). |
| `pos` | position | oui | Position du point de passage. |
| `type` | waypoint_type | non (défaut `"move"`) | Type de point de passage. |
| `replace` | boolean | non (défaut `false`) | true = efface le plan en cours et part tout de suite vers ce point ; false = l'ajoute à la suite. |
| `radius` | metres | non (défaut `0`) | Rayon de placement aléatoire du point, en mètres. |
| `behaviour` | behaviour | non (défaut `"unchanged"`) | Comportement adopté en atteignant ce point. |
| `combat_mode` | combat_mode | non (défaut `"unchanged"`) | Règle de tir adoptée en atteignant ce point. |
| `speed_mode` | speed_mode | non (défaut `"unchanged"`) | Vitesse sur ce tronçon. |
| `formation` | formation | non (défaut `"unchanged"`) | Formation sur ce tronçon. |

### `patrol`

Fait patrouiller un groupe en boucle autour d'un point (points de passage aléatoires, fonction officielle BIS_fnc_taskPatrol).

Renvoie : `group`, `waypoints`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe, ou unité (son groupe patrouillera). |
| `pos` | position | oui | Centre de la zone de patrouille. |
| `radius` | metres | non (défaut `200`) | Rayon de la patrouille en mètres. |

### `defend`

Fait défendre une zone à un groupe : les soldats occupent les positions dans les bâtiments proches, les autres se postent autour du point.

Renvoie : `group`, `garrisoned`, `positions`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe, ou unité (son groupe défendra). |
| `pos` | position | oui | Point à défendre. |
| `radius` | metres | non (défaut `100`) | Rayon dans lequel chercher des bâtiments à occuper. |

### `attack`

Ordonne à un groupe d'attaquer une cible (unité, véhicule ou groupe) : il la repère, la suit et ouvre le feu.

Renvoie : `group`, `target`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe qui attaque, ou unité (son groupe attaquera). |
| `target` | entity_id | oui | Cible : unité, véhicule ou groupe (son chef sera visé). |

### `artillery_fire`

Fait tirer une vraie pièce d'artillerie ou un mortier (avec son tireur) sur une position, avec ses propres munitions. Renvoie le temps de vol en secondes.

Renvoie : `id`, `magazine`, `eta`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Pièce d'artillerie ou mortier (véhicule avec tireur), ou son tireur. |
| `pos` | position | oui | Point visé. |
| `rounds` | count | non (défaut `3`) | Nombre d'obus. |

### `vehicle_crew`

Fait monter des soldats (une unité ou tout un groupe) dans un véhicule, ou les en fait descendre, en marchant ou instantanément.

Renvoie : `id`, `count`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Soldat ou groupe. |
| `action` | crew_action | oui | get_in = monter, get_out = descendre. |
| `vehicle` | entity_id | non (défaut `"none"`) | Véhicule où monter (obligatoire pour get_in). |
| `instant` | boolean | non (défaut `false`) | true = instantané (téléporté à bord ou dehors) ; false = les soldats y vont à pied. |

### `paradrop`

Parachute une unité ou les soldats IA d'un groupe au-dessus d'une position, à l'altitude choisie.

Renvoie : `id`, `count`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Soldat IA ou groupe (les joueurs ne sont pas déplacés). |
| `pos` | position | oui | Point au-dessus duquel sauter. |
| `altitude` | metres | non (défaut `300`) | Altitude d'ouverture en mètres. |

### `set_loadout`

Donne à un soldat l'équipement complet d'une classe de soldat du jeu (armes, munitions, tenue, sac).

Renvoie : `id`, `primary_weapon`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Soldat à équiper (IA ou joueur). |
| `from_class` | soldier_class | oui | Classe de soldat dont copier l'équipement. Exemples : `B_soldier_AR_F`, `B_soldier_LAT_F`, `B_medic_F`, `B_Sharpshooter_F`, `O_Soldier_AR_F` |

### `set_supplies`

Règle le carburant et/ou les munitions d'une unité, d'un véhicule ou de tout un groupe et de ses véhicules.

Renvoie : `id`, `count`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Unité, véhicule ou groupe (ses soldats et leurs véhicules). |
| `fuel` | keep_or_ratio | non (défaut `-1`) | Carburant des véhicules 0-1, -1 = inchangé. |
| `ammo` | keep_or_ratio | non (défaut `-1`) | Munitions 0-1, -1 = inchangées. |

### `fill_crate`

Remplit une caisse ou un véhicule avec des armes, munitions, équipements ou sacs (classes du catalogue), en vidant d'abord si demandé.

Renvoie : `id`, `added`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Caisse, objet ou véhicule à remplir. |
| `items` | cargo_items | oui | Liste [[classe, nombre], ...], par ex. [["30Rnd_65x39_caseless_mag", 20], ["FirstAidKit", 10]]. |
| `clear` | boolean | non (défaut `false`) | true = vide d'abord le contenu. |

### `query_area`

Question : quelles unités et quels véhicules se trouvent dans un rayon autour d'un point, triés par distance, avec le décompte par camp.

Renvoie : `units`, `vehicles`, `by_side`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `pos` | position | oui | Centre de la zone. |
| `radius` | metres | non (défaut `500`) | Rayon en mètres. |
| `side` | side_filter | non (défaut `"all"`) | Ne garder qu'un camp. |

### `query_knowledge`

Question : quels ennemis un camp connaît, avec son niveau de connaissance de chacun (0 à 4) et leur position quand il les a bien repérés.

Renvoie : `side`, `targets`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `side` | side | oui | Camp dont on veut la connaissance de l'ennemi. |
| `min_level` | knowledge | non (défaut `0.5`) | Niveau minimal de connaissance pour lister une cible. |
| `max` | max_results | non (défaut `50`) | Nombre maximal de cibles, les mieux connues d'abord. |

### `query_visibility`

Question : un observateur placé en un point voit-il un autre point ? Renvoie la visibilité de 0 à 1 (bâtiments et végétation compris) et si le relief bloque la vue.

Renvoie : `visibility`, `terrain_blocked`, `distance`, `height_difference`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `from` | position | oui | Position de l'observateur (au sol). |
| `to` | position | oui | Position regardée (au sol). |
| `from_height` | metres | non (défaut `1.7`) | Hauteur des yeux de l'observateur au-dessus du sol. |
| `to_height` | metres | non (défaut `1.7`) | Hauteur du point regardé au-dessus du sol. |

### `query_terrain`

Question : à quoi ressemble le terrain autour d'un point (altitude, eau, pente, lieu le plus proche, routes, bâtiments et places à l'intérieur, arbres).

Renvoie : `height`, `water`, `slope`, `location`, `roads`, `nearest_road`, `buildings`, `building_positions`, `trees`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `pos` | position | oui | Point à décrire. |
| `radius` | metres | non (défaut `150`) | Rayon pour compter routes, bâtiments et arbres. |

### `query_cover`

Question : où se mettre à couvert face à une menace ? Teste des points autour d'une position (et les places dans les bâtiments proches) et renvoie ceux que la menace ne voit pas, du plus proche au plus loin.

Renvoie : `threat`, `positions`, `checked`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `pos` | position | oui | Position autour de laquelle chercher un abri (là où se trouvent les soldats). |
| `threat` | position | oui | Position de la menace (ennemi, mitrailleuse...). |
| `radius` | metres | non (défaut `60`) | Rayon de recherche en mètres. |
| `max` | max_results | non (défaut `8`) | Nombre maximal de positions renvoyées. |

### `query_group`

Question : que fait un groupe (comportement, formation, points de passage, ennemis repérés par son chef avec leur distance, état de chaque soldat : santé, chargeurs, véhicule).

Renvoie : `group`, `leader`, `behaviour`, `combat_mode`, `speed_mode`, `formation`, `current_waypoint`, `waypoints`, `ready`, `known_enemies`, `units`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `id` | entity_id | oui | Groupe, ou unité (son groupe sera décrit). |

### `exec_sqf`

Exécute du code SQF libre sur la machine qui fait tourner le scénario. Les arguments sont disponibles dans _this. Puissant mais sans garde-fou.

Renvoie : `result`

| Paramètre | Type | Obligatoire | Description |
|---|---|---|---|
| `code` | code | oui | Code SQF ; la valeur de la dernière expression est renvoyée. Sans commentaires /* */ ni // : compile ne les retire pas. |
| `args` | array | non (défaut `[]`) | Arguments passés au code dans _this. |
| `scheduled` | boolean | non (défaut `false`) | true = lance le code en tâche de fond (autorise sleep/waitUntil), sans attendre de résultat. |

## Types

| Type | Nature | Valeurs | Description |
|---|---|---|---|
| `number` | number | none | Nombre (entier ou décimal). |
| `ratio` | number | 0..1 | Nombre entre 0 et 1. |
| `keep_or_ratio` | number | -1..1 | Nombre entre 0 et 1, ou -1 pour ne rien changer. |
| `hours` | number | -1..24 | Heure du jour en heures décimales (14.5 = 14h30), ou -1 pour ne rien changer. |
| `count` | number | 1..50 | Nombre entier entre 1 et 50. |
| `metres` | number | 0..5000 | Distance en mètres (0 à 5000). |
| `seconds` | number | 0..60 | Durée en secondes (0 à 60). |
| `knowledge` | number | 0..4 | Niveau de connaissance d'une cible par un camp, de 0 (inconnue) à 4 (parfaitement repérée). |
| `max_results` | number | 1..500 | Nombre maximal de résultats (1 à 500). |
| `string` | string | none | Texte libre. |
| `soldier_class` | string | none | Classe de soldat dont on copie l'équipement, par ex. B_soldier_AR_F ; voir GET /catalog, section units. |
| `cargo_items` | array | none | Liste [[classe, nombre], ...] d'armes, munitions, équipements ou sacs ; voir GET /catalog, sections weapons, magazines, gear et backpacks. |
| `unit_class` | string | none | Classe de soldat du jeu (CfgVehicles), par ex. B_Soldier_F ; voir GET /catalog, section units. |
| `vehicle_class` | string | none | Classe de véhicule du jeu (CfgVehicles), par ex. B_MRAP_01_F ; voir GET /catalog, section vehicles. |
| `object_class` | string | none | Classe d'objet du jeu (CfgVehicles), par ex. Box_NATO_Ammo_F ; voir GET /catalog, section objects. |
| `group_path` | string | none | Groupe officiel du jeu : chemin CfgGroups camp/faction/catégorie/groupe, par ex. West/BLU_F/Infantry/BUS_InfSquad ; voir GET /catalog, section groups. |
| `marker_type` | string | none | Icône de marqueur (CfgMarkers), par ex. mil_dot, mil_objective, hd_flag ; voir GET /catalog, section marker_types. |
| `marker_color` | string | none | Couleur de marqueur (CfgMarkerColors), par ex. ColorRed, ColorBLUFOR ; voir GET /catalog, section marker_colors. |
| `marker_name` | string | none | Nom unique du marqueur ; auto = nom généré. |
| `entity_id` | string | none | Identifiant attribué par le mod : u12 (soldat), v3 (véhicule), o7 (objet), g4 (groupe). |
| `code` | string | none | Code SQF. |
| `boolean` | boolean | none | true ou false. |
| `position` | position | none | Position [x, y] ou [x, y, z] en mètres ; z = hauteur au-dessus du sol (0 si absent). |
| `array` | array | none | Liste JSON quelconque (nombres, textes, booléens, listes). |
| `side` | enum | west\|east\|independent\|civilian | Camp : west (OTAN), east (CSAT), independent (AAF), civilian. |
| `side_or_default` | enum | default\|west\|east\|independent\|civilian | Camp, ou default pour le camp prévu par le jeu. |
| `audience` | enum | all\|west\|east\|independent\|civilian | Destinataires : tous les joueurs ou un camp. |
| `message_kind` | enum | system\|hint\|title\|side_chat\|subtitle | Forme du message : system (chat système), hint (encadré), title (texte au centre de l'écran), side_chat (radio du camp, signé HQ), subtitle (sous-titre signé HQ). |
| `behaviour` | enum | unchanged\|careless\|safe\|aware\|combat\|stealth | Comportement du groupe. |
| `combat_mode` | enum | unchanged\|blue\|green\|white\|yellow\|red | Règle de tir : blue = ne jamais tirer, green = riposte sans bouger, white = riposte, yellow = tir libre en gardant la formation, red = tir libre et engagement. |
| `speed_mode` | enum | unchanged\|limited\|normal\|full | Vitesse de déplacement du groupe. |
| `effect` | enum | artillery\|mortar\|bomb\|rockets\|grenade\|smoke_white\|smoke_red\|smoke_green\|smoke_blue\|smoke_screen\|flare_white\|flare_red\|flare_green\|mine_at\|mine_ap\|ied | Effet ou munition (voir le tableau des effets) : artillerie, mortier, bombe, roquettes, grenade, fumigènes, écran de fumée, fusées éclairantes, mines, IED. |
| `marker_shape` | enum | icon\|rectangle\|ellipse | Forme du marqueur : icon (icône + texte), rectangle ou ellipse (zone). |
| `waypoint_type` | enum | move\|sad\|destroy\|guard\|hold\|sentry\|get_in\|get_out\|unload\|transport_unload\|loiter\|cycle\|dismiss | Type de point de passage : move (aller), sad (chercher et détruire), destroy, guard (garder), hold (tenir), sentry (sentinelle), get_in (monter dans le véhicule le plus proche), get_out (descendre), unload (débarquer les passagers), transport_unload, loiter (tourner, aéronefs), cycle (revenir au premier point : patrouille), dismiss (quartier libre). |
| `formation` | enum | unchanged\|column\|stag_column\|wedge\|ech_left\|ech_right\|vee\|line\|file\|diamond | Formation du groupe. |
| `stance` | enum | unchanged\|auto\|up\|middle\|down | Posture imposée aux soldats : auto, debout, accroupi, couché. |
| `crew_action` | enum | get_in\|get_out | Monter dans un véhicule ou en descendre. |
| `side_filter` | enum | all\|west\|east\|independent\|civilian | Tous les camps ou un seul. |

## Flux d'état

Message `{"type": "state", "seq": n, "world": {...}, "units": [...], ...}` toutes les `state_interval_ms` millisecondes ; aussi disponible en `GET /state`.

### `world`

État global de la partie.

| Champ | Type | Description |
|---|---|---|
| `world` | string | Carte jouée. |
| `mission` | string | Nom du scénario. |
| `time` | number | Secondes écoulées depuis le début du scénario. |
| `daytime` | number | Heure du jour en heures décimales. |
| `date` | array | Date du jeu [année, mois, jour, heure, minute]. |
| `overcast` | number | Couverture nuageuse 0-1. |
| `rain` | number | Pluie 0-1. |
| `fog` | number | Brouillard 0-1. |
| `fps` | number | Images par seconde de la machine qui fait tourner le scénario. |
| `players` | number | Nombre de joueurs humains. |
| `size` | number | Taille de la carte en mètres (côté du carré). |

### `units`

Soldats et joueurs (morts compris si include_dead).

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Identifiant stable. |
| `type` | string | Classe du soldat. |
| `name` | string | Nom affiché. |
| `side` | string | Camp. |
| `group` | entity_id | Groupe. |
| `pos` | position | Position [x, y, z au-dessus du sol]. |
| `dir` | number | Orientation en degrés. |
| `health` | number | Santé 0-1. |
| `alive` | boolean | Vivant ? |
| `vehicle` | entity_id | Véhicule occupé (vide si à pied). |
| `is_player` | boolean | Joueur humain ? |
| `speed` | number | Vitesse en km/h. |

### `vehicles`

Véhicules terrestres, aériens, navals et armes fixes.

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Identifiant stable. |
| `type` | string | Classe du véhicule. |
| `side` | string | Camp (civilian si vide). |
| `pos` | position | Position. |
| `dir` | number | Orientation. |
| `health` | number | Santé 0-1. |
| `alive` | boolean | Intact ? |
| `fuel` | number | Carburant 0-1. |
| `crew` | array | Identifiants des occupants. |
| `speed` | number | Vitesse en km/h. |

### `groups`

Groupes d'IA et de joueurs non vides.

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Identifiant stable. |
| `name` | string | Indicatif (Alpha 1-1...). |
| `side` | string | Camp. |
| `leader` | entity_id | Chef du groupe. |
| `units` | array | Membres. |
| `behaviour` | string | Comportement actuel. |
| `combat_mode` | string | Règle de tir actuelle. |
| `speed_mode` | string | Vitesse actuelle. |
| `destination` | array | Position du point de passage en cours (vide si aucun). |

### `objects`

Objets posés par le scénario ou créés par spawn_object (hors décor de la carte).

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Identifiant stable. |
| `type` | string | Classe de l'objet. |
| `pos` | position | Position. |
| `dir` | number | Orientation. |
| `health` | number | Santé 0-1. |

### `markers`

Marqueurs de la carte (scénario, joueurs et set_marker).

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom du marqueur (à passer à set_marker ou delete_marker). |
| `type` | string | Icône. |
| `text` | string | Texte. |
| `color` | string | Couleur (classe CfgMarkerColors). |
| `shape` | string | Forme : icon, rectangle, ellipse ou polyline. |
| `pos` | position | Position. |
| `size` | array | Taille [x, y]. |
| `dir` | number | Orientation. |
| `alpha` | number | Opacité. |

## Événements

Message `{"type": "event", "seq": n, "event": "<nom>", "time": t, "data": {...}}` ; historique en `GET /events?since=<seq>`.

### `mission_started`

Le scénario vient de démarrer (le mod est prêt).

| Champ | Type | Description |
|---|---|---|
| `world` | string | Carte. |
| `mission` | string | Scénario. |
| `dedicated` | boolean | Serveur dédié ? |

### `killed`

Une unité ou un véhicule a été tué ou détruit.

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Entité tuée. |
| `type` | string | Sa classe. |
| `killer` | entity_id | Tueur (vide si inconnu). |
| `instigator` | entity_id | Personne qui a appuyé sur la détente (vide si inconnu). |
| `pos` | position | Lieu. |

### `fired`

Une IA a tiré : origine, direction et type de munition (désactivable avec le réglage fired_events).

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Tireur. |
| `weapon` | string | Arme. |
| `ammo` | string | Munition. |
| `vehicle` | entity_id | Véhicule depuis lequel il tire (vide si à pied). |
| `pos` | position | Origine du tir. |
| `dir` | array | Direction du tir [x, y, z] (vecteur unitaire). |
| `kind` | string | Type de projectile : shotBullet, shotShell, shotRocket, shotMissile, shotGrenade, shotSmoke... |
| `side` | string | Camp du tireur. |

### `player_fired`

Un joueur a tiré (capté dans son jeu, au plus un tir relayé toutes les 0,15 s par joueur).

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Joueur qui tire. |
| `weapon` | string | Arme. |
| `ammo` | string | Munition. |
| `vehicle` | entity_id | Véhicule depuis lequel il tire (vide si à pied). |
| `pos` | position | Origine du tir (position du projectile au départ, mesurée dans le jeu du joueur). |
| `dir` | array | Direction du projectile [x, y, z] (mesurée dans le jeu du joueur, tourelles de véhicule comprises). |
| `kind` | string | Type de projectile. |
| `side` | string | Camp du joueur. |

### `hit`

Une unité suivie a été touchée (IA du serveur).

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Unité touchée. |
| `by` | entity_id | Tireur (vide si inconnu). |
| `damage` | number | Dégâts de ce coup. |
| `health` | number | Santé restante 0-1. |

### `waypoint_completed`

Un groupe a atteint un point de passage.

| Champ | Type | Description |
|---|---|---|
| `group` | entity_id | Groupe. |
| `index` | number | Numéro du point atteint. |
| `remaining` | number | Points de passage restants. |
| `pos` | position | Position du point atteint. |

### `enemy_detected`

Un groupe vient de repérer un nouvel ennemi.

| Champ | Type | Description |
|---|---|---|
| `group` | entity_id | Groupe qui a repéré. |
| `target` | entity_id | Ennemi repéré. |
| `type` | string | Sa classe. |
| `side` | string | Son camp. |
| `pos` | position | Sa position. |

### `combat_changed`

Un groupe a changé de comportement (passe en combat, revient au calme...). Malgré son nom, l'événement moteur CombatModeChanged signale le comportement (SAFE, AWARE, COMBAT...).

| Champ | Type | Description |
|---|---|---|
| `group` | entity_id | Groupe. |
| `behaviour` | string | Nouveau comportement (careless, safe, aware, combat, stealth). |

### `group_fleeing`

Un groupe commence ou cesse de fuir.

| Champ | Type | Description |
|---|---|---|
| `group` | entity_id | Groupe. |
| `fleeing` | boolean | true = commence à fuir, false = se reprend. |

### `created`

Une unité ou un véhicule vient d'apparaître.

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Nouvelle entité. |
| `type` | string | Sa classe. |
| `pos` | position | Position. |

### `deleted`

Une entité suivie par le mod a été supprimée.

| Champ | Type | Description |
|---|---|---|
| `id` | entity_id | Entité supprimée. |
| `type` | string | Sa classe. |

### `player_connected`

Un joueur s'est connecté (multijoueur).

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom du joueur. |
| `uid` | string | Identifiant Steam. |
| `jip` | boolean | Arrivé en cours de partie ? |

### `chat`

Un joueur a écrit dans le chat (global, camp, commandement, groupe, véhicule ou direct). Capté dans le jeu de chaque joueur (le serveur dédié ne voit pas le chat) ; chacun ne relaie que ses propres messages.

| Champ | Type | Description |
|---|---|---|
| `channel` | string | Canal : global, side, command, group, vehicle, direct ou custom. |
| `from` | string | Nom du joueur. |
| `unit` | entity_id | Unité du joueur. |
| `side` | string | Camp du joueur. |
| `text` | string | Message. |

### `player_disconnected`

Un joueur s'est déconnecté (multijoueur).

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom du joueur. |
| `uid` | string | Identifiant Steam. |

## Effets (`spawn_effect`)

| Effet | Nature | Classe | Description |
|---|---|---|---|
| `artillery` | projectile | `Sh_155mm_AMOS` | Obus d'artillerie explosif de 155 mm qui tombe du ciel. |
| `mortar` | projectile | `Sh_82mm_AMOS` | Obus de mortier explosif de 82 mm. |
| `bomb` | projectile | `Bo_GBU12_LGB` | Bombe de 500 livres (grosse explosion). |
| `rockets` | projectile | `R_80mm_HE` | Roquette explosive de 80 mm. |
| `grenade` | projectile | `GrenadeHand` | Grenade à main qui explose après quelques secondes. |
| `smoke_white` | smoke | `SmokeShell` | Fumigène blanc. |
| `smoke_red` | smoke | `SmokeShellRed` | Fumigène rouge. |
| `smoke_green` | smoke | `SmokeShellGreen` | Fumigène vert. |
| `smoke_blue` | smoke | `SmokeShellBlue` | Fumigène bleu. |
| `smoke_screen` | projectile | `Smoke_120mm_AMOS_White` | Obus fumigène d'artillerie : grand écran de fumée. |
| `flare_white` | flare | `F_40mm_White` | Fusée éclairante blanche qui descend lentement. |
| `flare_red` | flare | `F_40mm_Red` | Fusée éclairante rouge. |
| `flare_green` | flare | `F_40mm_Green` | Fusée éclairante verte. |
| `mine_at` | mine | `ATMine` | Mine antichar posée au sol. |
| `mine_ap` | mine | `APERSMine` | Mine antipersonnel posée au sol. |
| `ied` | mine | `IEDUrbanBig_F` | Gros engin explosif improvisé (IED) urbain. |

## Catalogue (`GET /catalog`)

Lu dans la configuration du jeu au démarrage de chaque partie (DLC et mods compris). Réponse : `{"sections": {"<section>": {"fields": [...], "rows": [[...], ...]}}}` ; le premier champ de chaque section est la valeur à passer à l'ordre correspondant.

### `units`

Soldats et civils plaçables (spawn_unit), hors unités techniques (headless client, spectateur).

| Champ | Description |
|---|---|
| `class` | Nom de classe à passer à spawn_unit. |
| `name` | Nom affiché dans le jeu. |
| `side` | Camp. |
| `faction` | Faction (OTAN, CSAT, AAF, FIA...). |
| `category` | Catégorie de l'éditeur (Hommes, Forces spéciales...). |
| `dlc` | DLC ou mod d'origine (vide = jeu de base). |

### `vehicles`

Véhicules terrestres, aériens, navals et armes fixes (spawn_vehicle).

| Champ | Description |
|---|---|
| `class` | Nom de classe à passer à spawn_vehicle. |
| `name` | Nom affiché dans le jeu. |
| `side` | Camp de l'équipage par défaut. |
| `faction` | Faction. |
| `kind` | Genre : car, tank, helicopter, plane, boat, static, other. |
| `category` | Catégorie de l'éditeur. |
| `dlc` | DLC ou mod d'origine. |

### `objects`

Objets plaçables de l'éditeur : caisses, fortifications, bâtiments, décor (spawn_object).

| Champ | Description |
|---|---|
| `class` | Nom de classe à passer à spawn_object. |
| `name` | Nom affiché dans l'éditeur. |
| `category` | Catégorie de l'éditeur (Fortifications, Caisses...). |
| `subcategory` | Sous-catégorie de l'éditeur. |
| `dlc` | DLC ou mod d'origine. |

### `groups`

Groupes officiels : escouades, équipes, pelotons, convois (spawn_group).

| Champ | Description |
|---|---|
| `path` | Chemin à passer à spawn_group (camp/faction/catégorie/groupe). |
| `name` | Nom affiché du groupe. |
| `side` | Camp. |
| `faction` | Faction. |
| `category` | Catégorie (Infanterie, Motorisé, Mécanisé...). |
| `size` | Nombre d'unités et de véhicules du groupe. |

### `weapons`

Armes : fusils, pistolets, lanceurs (fill_crate).

| Champ | Description |
|---|---|
| `class` | Classe à mettre dans fill_crate. |
| `name` | Nom affiché. |
| `kind` | Genre : primary (fusil, mitrailleuse), handgun, launcher. |
| `dlc` | DLC ou mod d'origine. |

### `magazines`

Chargeurs, grenades, roquettes et explosifs (fill_crate).

| Champ | Description |
|---|---|
| `class` | Classe à mettre dans fill_crate. |
| `name` | Nom affiché. |
| `rounds` | Nombre de coups. |

### `gear`

Équipements : trousses de soin, outils, optiques, accessoires, tenues, gilets, casques (fill_crate).

| Champ | Description |
|---|---|
| `class` | Classe à mettre dans fill_crate. |
| `name` | Nom affiché. |
| `kind` | Genre : muzzle, optic, pointer, bipod, headgear, vest, uniform, nvg ou item (soin, outils...). |

### `backpacks`

Sacs à dos (fill_crate).

| Champ | Description |
|---|---|
| `class` | Classe à mettre dans fill_crate. |
| `name` | Nom affiché. |
| `capacity` | Capacité. |

### `marker_types`

Icônes de marqueurs (set_marker) ; les icônes militaires courantes (mil_*) ont scope 1, d'où > 0.

| Champ | Description |
|---|---|
| `class` | Type à passer à set_marker. |
| `name` | Nom affiché. |

### `marker_colors`

Couleurs de marqueurs (set_marker) ; toutes, car les couleurs de camp courantes (ColorBLUFOR...) ont scope 0.

| Champ | Description |
|---|---|
| `class` | Couleur à passer à set_marker. |
| `name` | Nom affiché. |
| `rgba` | Couleur [rouge, vert, bleu, opacité] entre 0 et 1. Les couleurs de camp dépendent du profil du joueur : un serveur dédié renvoie des valeurs par défaut, que la page web remplace par les couleurs standard des camps. |

## Réglages

À placer dans `a3_bridge.json`, à côté de `a3_bridge_x64.dll`.

| Clé | Défaut | Description |
|---|---|---|
| `port` | 8765 | Port local (127.0.0.1) de la passerelle HTTP + WebSocket. |
| `state_interval_ms` | 100 | Intervalle entre deux photos de l'état, en millisecondes. |
| `include_dead` | true | Inclure les soldats morts dans la liste des unités. |
| `max_objects` | 500 | Nombre maximal d'objets envoyés dans l'état. |
| `fired_events` | true | Envoyer un événement à chaque tir. |
| `max_commands_per_frame` | 25 | Nombre maximal d'ordres exécutés par image du jeu. |
| `chunk_size` | 4000 | Taille des morceaux de texte envoyés du jeu vers la passerelle. |
| `command_timeout_ms` | 10000 | Délai maximal d'attente du résultat d'un ordre. |
| `event_history` | 2000 | Nombre d'événements gardés en mémoire pour GET /events. |
| `max_clients` | 16 | Nombre maximal de clients WebSocket simultanés. |
| `catalog_export` | true | Lire le catalogue du jeu (classes plaçables, groupes, marqueurs) au démarrage de chaque partie, pour GET /catalog et la page web. |
| `map_export` | true | Construire la carte de fond de la page web à la première partie sur chaque carte (mise en cache ensuite). |
| `map_height_cell_m` | 16 | Taille visée d'une case de relief, en mètres. |
| `map_max_cells` | 512 | Nombre maximal de cases de relief par côté (limite la durée de l'export sur les grandes cartes). |
| `map_forest_cell_m` | 64 | Taille d'une case de densité de forêt, en mètres (256 cases par côté au plus). |
