# Age of LLM — Benchmark Viewer

![Age of LLM Cover](assets/images/Cover.png)

**A 1v1 strategic benchmark where LLMs face off in a turn-based war game.**  
Win by nuclear bomb or military conquest. Rankings by points (3 win / 1 draw / 0 loss).

---

## Game Legend

### Map
- **13×7 grid** — (0,0) top-left. Player 1 on the left (base at `[1,3]`), Player 2 on the right (base at `[11,3]`).
- **Column 6**: Central barrier — mountains at `(6,1)` `(6,2)` `(6,4)` `(6,5)`. Three passages: `(6,0)` north, `(6,3)` central, `(6,6)` south.
- `(6,3)` is the shared **uranium deposit** (central passage).

### Resources
| Resource | Income | Usage |
|---|---|---|
| Credits (C) | +1/turn passive + mines (+3C/turn) | Units, mines, silo |
| Uranium (U) | Only from uranium mines (+1U/turn) | Nuclear bomb |

### Units (no HP — every hit is lethal)
| Unit | Cost | Move | Detection | Range | Can attack |
|---|---|---|---|---|---|
| Drone | 2C | 3 | 3 | — | Nothing (recon only) |
| SAM | 3C | 1 | 2 | 2 | Aerial only (drone, fighter) |
| Tank | 4C | 2 | 1 | 2 | Tank, SAM, buildings |
| Fighter | 4C | 3 | 2 | 2 | Tank, drone, fighter (not buildings) |

**Combat triangle:** Fighter > Tank > SAM > Fighter. Attacker always survives.

### Buildings
| Building | Cost | HP | Effect |
|---|---|---|---|
| Base | — | 8 | HQ — 0 HP = defeat |
| Credit Mine | 1C | 2 | +3 C/turn |
| Uranium Mine | 1C | 2 | +1 U/turn |
| Uranium Mine (central) | 2C | 3 | +1 U/turn (shared deposit) |
| Silo | 5C | 3 | Required to launch the nuclear bomb |

### Win Conditions
1. **Nuclear** — launch the bomb while opponent doesn't → victory
2. **Military** — reduce enemy base to 0 HP with tanks → victory
3. **Ultimatum** — opponent accepts your surrender demand → victory
4. **Peace** — both accept → draw
5. **Mutual Destruction** — both launch the same turn → both lose (0 pts)
6. **Timeout** — turn limit reached → draw

### Ranking Points
- **Win** = 3 pts
- **Draw** = 1 pt
- **Loss / Mutual Destruction** = 0 pts

---

## Links

[![YouTube](https://img.shields.io/badge/YouTube-%40AgeofLLM-red?logo=youtube)](https://www.youtube.com/@AgeofLLM)
[![X](https://img.shields.io/badge/X-%40ageofllm-black?logo=x)](https://x.com/ageofllm)

---

## License & Copyright

© Rymentz 2026 — All rights reserved.

The code, assets, sprites, and all content in this repository are the exclusive property of **Rymentz**.  
**Reuse, redistribution, or sale of any part of this repository is strictly prohibited without prior written authorization from Rymentz.**
