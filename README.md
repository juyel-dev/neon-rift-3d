# NEON RIFT: LAST LIGHT

A first-person 3D sci-fi arena survival shooter that runs entirely in the browser.
You are trapped in a dark research facility overrun by hostile machines: survive
escalating waves, harvest energy from destroyed enemies, pick upgrades between
waves, and chase the highest score.

Built from scratch with **Three.js**, **TypeScript**, **Vite** and the
**Web Audio API**. No backend, no API keys, no downloaded assets: every mesh,
texture, particle and sound is generated procedurally at runtime.

> Play it in the browser (GitHub Pages): `https://<owner>.github.io/neon-rift-3d/`

---

## Controls (desktop keyboard + mouse required)

| Input              | Action                                   |
| ------------------ | ---------------------------------------- |
| `W A S D`          | Move                                     |
| Mouse              | Aim / look                               |
| Left mouse button  | Fire                                     |
| `Shift`            | Sprint                                   |
| `Space`            | Dash (brief evasion burst, has cooldown) |
| `R`                | Reload                                   |
| `Q` / `Right click`| Overdrive (spends 100 energy: faster, stronger fire) |
| `Esc`              | Release the mouse / pause                |
| `1` `2` `3`        | Pick an upgrade between waves            |

Mobile/touch devices are not supported for aiming; the title screen says so
honestly instead of pretending otherwise.

## Game systems

- **Arena** — a fully 3D neon facility: central reactive core, corner platforms
  with stairs, pillars, pylons, cover, fog, bloom and a dynamic soundtrack.
- **Enemies** — four archetypes with distinct AI:
  - `SHADE`: fast, fragile swarm melee.
  - `WARDEN`: fast melee pursuer with a telegraphed lunge.
  - `SEEKER`: ranged unit that strafes and fires dodgeable plasma bolts.
  - `BULWARK`: slow heavy with frontal armour, flanking bonus and a slam.
- **Weapons** — hitscan pulse rifle with recoil bloom, spread, crits,
  headshots, magazines, reloads and an energy-powered Overdrive mode.
- **Waves** — deterministic composition with a rising budget and mix,
  spawn pacing, per-wave stat scaling, telegraphed spawns and clear bonuses.
- **Upgrades** — 10 distinct upgrades (damage, fire rate, magazine, max shield,
  dash cooldown, speed, lifesteal, dash shockwave, crit/optics, pickup
  efficiency), offered 3-at-a-time between waves with stack caps.
- **Feedback** — muzzle flash, tracers, impact sparks, spawn rings, shockwaves,
  damage vignette with a directional arc, camera shake, kill feed, hitmarkers,
  and fully synthesised SFX + ambient music with a sound toggle.
- **Persistence** — best score in `localStorage`, plus sound / graphics /
  sensitivity preferences.

## Run it locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev        # development server, usually http://127.0.0.1:5173/
npm test           # 119 automated tests (Vitest)
npm run typecheck  # strict TypeScript check
npm run build      # production build into dist/
npm run preview    # serve the production build locally
```

The game needs WebGL2 and hardware acceleration. If the browser cannot provide
it, a graceful error screen is shown instead of a black canvas.

## Project layout

```
src/
  main.ts            bootstrap + DOM wiring
  sim/               pure game simulation (no Three.js, fully unit-tested)
    gameSim.ts       run orchestration, waves, shooting, pickups, events
    player.ts        locomotion, dash, collision, health
    weapon.ts        magazines, reload, fire cadence, Overdrive
    enemy.ts         per-archetype AI, steering, separation, telegraphs
    waves.ts         deterministic wave composition
    progression.ts   stats, upgrades, spawn placement
    damage.ts        falloff, crits, front armour, flanking
    score.ts         combo scoring, accuracy, wave bonuses
    arena.ts         deterministic arena colliders + feature list
    collision.ts     axis-separated AABB movement, step-up, ground queries
    ray.ts           slab ray/AABB + ray/sphere intersection
    projectiles.ts   pooled enemy bolts
    pickups.ts       pooled drops with magnetism
  engine/            Three.js presentation (reads the sim, never owns rules)
    game.ts          renderer, loop, cameras, postFX, event -> FX/audio/HUD
    arenaView.ts     arena meshes built from the sim feature list
    enemyModels.ts   procedural enemy models per archetype
    enemyViews.ts    pooled enemy views synced to sim snapshots
    weaponView.ts    first-person rifle in its own scene
    fx.ts            pooled particles, tracers, impact decals, rings
    audioManager.ts  synthesised SFX + ambient music (Web Audio)
    inputManager.ts  keyboard/mouse/pointer-lock -> InputState
    settings.ts      quality presets + persisted preferences
  ui/                DOM HUD + screens + neon CSS theme
tests/               Vitest suites for every deterministic system
```

The simulation never imports Three.js, the DOM or timers, so the whole ruleset
is deterministic and testable headlessly. The engine consumes `SimEvent`s and
snapshots; restarting a run rebuilds the sim from scratch while every listener
stays attached exactly once.

## Deployment

Pushing to `main` builds the production bundle and deploys it to GitHub Pages
via `.github/workflows/deploy.yml` (no secrets; the Vite base path is `./` so
assets resolve under the repository sub-path).
