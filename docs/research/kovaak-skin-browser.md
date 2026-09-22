# KovaaK's Skin Browser — where the choice lives and which skins exist

Surveyed read-only on the tester's install on 2026-09-21. Steam build `25192921`, pak dated
2026-09-12. The user equipped one skin on each shape in the game, then closed it, so the stored
form could be read.

## Where the choice is stored

`FPSAimTrainer\Saved\SaveGames\PrimaryUserSettings.json`, as two top-level keys next to the six
settings sections:

```json
"characterModelOverride": {
  "Cylindrical": { "characterModel": "Stylized Ecto", "characterSkin": "Default" },
  "Cuboid":      { "characterModel": "Ghost",         "characterSkin": "Default" },
  "Spheroid":    { "characterModel": "Mummy",         "characterSkin": "Default" }
},
"currentlySelectedBoundingBoxType": "Spheroid"
```

Before equipping, all six values were `"None"`. The three keys are the Skin Browser's shape icons
(humanoid, cube, sphere). `currentlySelectedBoundingBoxType` is only the tab the browser had open
last; it is not an enemy setting. The game rewrote the file when it closed.

## No skin files on disk

None exist under the game folder, `Saved\`, `%LOCALAPPDATA%\FPSAimTrainer` or
`steamapps\workshop\content\824270` (the Workshop items there are only `.sce` scenarios). The
browser is a built-in widget (`/Game/FirstPersonBP/Blueprints/UI/CharacterStuff/CharcterSkinPreview/`).
Its list is the DataTable `CharacterSkinPreviewViewModelDataTable` inside
`FPSAimTrainer-WindowsNoEditor.pak`. That asset is stored uncompressed and unencrypted, so its
UE4 tagged properties were decoded directly: a one-off read of about 120 KB around the asset, not a
pak extraction. Aimloom can choose among these skins. It cannot add new ones.

## The table (15 rows)

Each row has `CharacterModelID {CharacterModel, CharacterSkin}` (the two strings written to the
JSON), `DisplayText` (the browser's label), `SupportedBoundingBoxTypes` (a bitmask), and a
thumbnail, offset and scale. The thumbnails are the game's own textures, and Aimloom must not ship them.

| DisplayText | characterModel | characterSkin | Shapes |
|---|---|---|---|
| None | None | None | all (7) |
| Ghost | Ghost | Default | all (7) |
| Mummy | Mummy | Default | all (7) |
| Stylized | Stylized Ecto | Default | humanoid (2) |
| Ecto | Ecto | Default | humanoid (2) |
| Endo | Endo | Default | humanoid (2) |
| Meso | Meso | Default | humanoid (2) |
| Shinji | Meso | Genji | humanoid (2) |
| McCoy | Meso | McCree | humanoid (2) |
| Rocket Flyer | Meso | Pharah | humanoid (2) |
| Racer | Meso | Tracer | humanoid (2) |
| Swat Arya | Anime Girl | Default | humanoid (2) |
| Swat Katsumi | Anime Girl | Katsumi - SWAT | humanoid (2) |
| School Arya | Anime Girl | Arya - School | humanoid (2) |
| School Katsumi | Anime Girl | Katsumi - School | humanoid (2) |

Bit 2 is the humanoid (`Cylindrical`) box: the user's `Stylized Ecto` went there, and the cube
browser in the screenshot offered only None, Ghost and Mummy. Which of bits 1 and 4 is the cube
and which is the sphere is not known. No row needs it.

The pair is the identity. `Meso` alone is four different skins, so a writer must set both strings
together.

## Not known

- Whether the game picks up a value written while it is closed. This is likely, since it reads
  the file at start, but it has not been observed.
- What the game does with a pair that is not in its table (for example after a game update
  removes a row).
- Whether a write made while the game is running survives. The game rewrites the whole file on
  exit, so a write made while it runs is probably lost.
- The pak also names models the browser does not offer (Pigeon, Pill, Pumpkin, Medusa, Diver,
  JackOLantern). They are not in this table and are out of scope.
