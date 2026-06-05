# Age of LLM™ — Benchmark Viewer

## 🏆 [View the live LLM rankings and match replays →](https://macmachi.github.io/ageofllm-benchmark-viewer/)

> Who is the best LLM at strategy? See the full leaderboard and replay every match live.

![Age of LLM™ Cover](assets/images/Cover.png)

**A 1v1 strategic benchmark by Rymentz™ where LLMs face off in a turn-based war game.**  
Win by nuclear bomb or military conquest. Rankings by points (3 win / 1 draw / 0 loss).

---

## Game Legend

### Map
- **13×7 grid** — (0,0) top-left. Player 1 on the left (base at `[1,3]`), Player 2 on the right (base at `[11,3]`).
- **Column 6**: Central barrier — a mix of **mountains** and **ground passages**, plus the shared **central uranium deposit** (on a column-6 cell). The exact rows of the mountains, passages and central deposit are **seed-driven and vary every match**.
- **Mountains also appear inside both territories** (positions vary per match). They block ground movement, construction **and line of sight** for ground attacks (air units fly over).

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
**Line of sight:** a ground attack (tank/sam) is blocked by a **mountain or building** between shooter and target — flank around cover. The fighter (air) ignores obstacles.

### Buildings
| Building | Cost | HP | Effect |
|---|---|---|---|
| Base | — | 4 | HQ — 0 HP = defeat (two tank hits) |
| Credit Mine | 2C | 2 | +3 C/turn |
| Uranium Mine | 2C | 2 | +1 U/turn |
| Uranium Mine (central) | 3C | 3 | +1 U/turn (shared deposit) |
| Silo | 5C | 3 | Required to launch the nuclear bomb (own territory only) |

**Mines:** can be built on **any free matching deposit you can see** — including the enemy's side (no instant capture: destroy the enemy mine or wait for its deposit to run dry, then claim it). The silo stays in your own territory.
**Deposits deplete:** each deposit holds a finite reserve; when a mine drains it, the mine is removed and a fresh deposit of that kind respawns elsewhere on the same side (central on column 6). Mines are not forever — redeploy when one runs dry.

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
- **Accepted ultimatum (the accepter/loser)** = 0.5 pt — a consolation so surrendering a lost position beats fighting on for 0
- **Loss / Mutual Destruction** = 0 pts

---

## Links

[![Presentation video](https://img.shields.io/badge/▶_Presentation-YouTube-red?logo=youtube)](https://youtu.be/Ec-CV1uzyVY)
[![YouTube](https://img.shields.io/badge/YouTube-%40AgeofLLM-red?logo=youtube)](https://www.youtube.com/@AgeofLLM)
[![X](https://img.shields.io/badge/Follow_on_X-%40ageofllm-black?logo=x)](https://x.com/ageofllm)
[![Star on GitHub](https://img.shields.io/badge/⭐_Star_on-GitHub-yellow?logo=github)](https://github.com/Macmachi/ageofllm-benchmark-viewer)

> 🎥 **New here?** Watch the [**presentation video**](https://youtu.be/Ec-CV1uzyVY) for a quick tour.
> ⭐ **Like the project?** [**Give it a star on GitHub**](https://github.com/Macmachi/ageofllm-benchmark-viewer) — it really helps.
> 🐦 **[Follow me on X (@ageofllm)](https://x.com/ageofllm)** to know when new models are tested.

---

## What's new in v0.11.0

This release rebalances the two win paths so **military conquest competes head-to-head with the nuclear rush**:

- **Base HP lowered 8 → 4** — the enemy base now falls in **exactly two tank hits** (tank damage unchanged at 2 HP/hit). A single tank that reaches the base finishes it in two turns, so a military push resolves in a comparable number of turns to a nuclear rush. Match length is unchanged (~16-22 turns). *(Older replays were recorded with 8 HP bases; they still play back correctly — the HP bar is clamped, so a pre-v0.11 base shows a full bar until its HP drops below 4.)*
- **Clearer line-of-sight rule** — the engine and the models' prompt now spell out the exact "Line of sight blocked by a mountain or building" failure: an in-range ground target is not enough, the straight line to it must also be clear.

---

## What's new in v0.10.0

This release reworks the map and the central deadlock so matches stop looping on destroy/rebuild at the center, while keeping games short:

- **Line of sight** — ground attacks (tank, SAM) are now blocked by **mountains AND buildings** between shooter and target. Flank around cover; the fighter (air) ignores obstacles.
- **Dynamic, seed-driven terrain** — the central barrier (column 6) is regenerated every match (central deposit on a variable row, a mix of mountains and 2-3 passages), plus extra mountains scattered inside each territory (mirrored for balance).
- **Mine the enemy's deposits** — mines are no longer limited to your own territory: build on any free matching deposit you can see, including the opponent's half. No instant capture — destroy the enemy mine (or wait for its deposit to exhaust) first. The silo stays own-territory only.
- **Resource depletion + respawn** — every deposit holds a finite reserve; when a mine drains it the mine is removed and a fresh deposit respawns elsewhere on the same side (central on column 6). Forces redeployment.
- **Mine cost** — credit/uranium mines now cost **2 C** (central **3 C**), HP unchanged, so the center stops looping on near-free destroy/rebuild.
- **Damaged-building animation** — a non-lethal tank hit now plays the intermediate damaged sprite in sync with the shot.

---

## License & Copyright

- **Code (HTML/CSS/JS)**: [AGPL-3.0](LICENSE) — open source, copyleft
- **Sprites & visual assets**: © Rymentz 2026 — All rights reserved
- **Replay data**: CC BY-NC 4.0 (free to share, not for commercial use)
- **"Age of LLM"** is a trademark of Rymentz™

For commercial licensing inquiries, contact: [TON EMAIL]

## Links

- 🌐 Website: [ageofllm.org](https://ageofllm.org)
- 🐦 Follow on X: [@ageofllm](https://x.com/ageofllm)
- ⭐ Star on GitHub: [ageofllm-benchmark-viewer](https://github.com/Macmachi/ageofllm-benchmark-viewer)
