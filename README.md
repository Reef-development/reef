# 🚀 Running the Prototype

A quick-start guide to get this app running locally — no configuration required, the `.env` values are already included.

---

## 📋 Contents

- [Prerequisites](#-prerequisites)
- [1. Open a Terminal](#1️⃣-open-a-terminal-in-the-project-folder)
- [2. Install Dependencies](#2️⃣-install-dependencies)
- [3. Start the App](#3️⃣-start-the-app)
- [4. Open the App](#4️⃣-open-the-app)
- [Troubleshooting](#-if-it-does-not-start)

---

## ✅ Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** v18+ | Check with `node -v` |
| **Package manager** | npm (bundled with Node), or yarn / pnpm / bun |

> 💡 The `.env` file already contains the required values — you don't need to create or edit anything.

---

## 1️⃣ Open a Terminal in the Project Folder

Navigate to the project root (the folder containing `package.json`):

```bash
cd path/to/project
```

---

## 2️⃣ Install Dependencies

Pick whichever matches your setup:

<table>
<tr><th>Tool</th><th>Command</th></tr>
<tr><td>npm</td><td>

```bash
npm install
```

</td></tr>
<tr><td>yarn</td><td>

```bash
yarn install
```

</td></tr>
<tr><td>pnpm</td><td>

```bash
pnpm install
```

</td></tr>
<tr><td>bun</td><td>

```bash
bun install
```

</td></tr>
</table>

---

## 3️⃣ Start the App

<table>
<tr><th>Tool</th><th>Command</th></tr>
<tr><td>npm</td><td>

```bash
npm run dev
```

</td></tr>
<tr><td>yarn</td><td>

```bash
yarn dev
```

</td></tr>
<tr><td>pnpm</td><td>

```bash
pnpm dev
```

</td></tr>
<tr><td>bun</td><td>

```bash
bun run dev
```

</td></tr>
</table>

This runs the `dev` script defined in `package.json`, which launches the local **Vite** development server.

---

## 4️⃣ Open the App

Once the server starts, the terminal will print a local URL. By default, Vite runs at:

```
http://localhost:5173
```

Open that address in your browser. 🎉

You'll land on the sign-in screen:


> 🔑 **For the lecturer:** No need to register or sign in manually — use the **Demo Access** buttons at the bottom of the screen (`OWNER DEMO` or `WORKER DEMO`) to jump straight into each role's view.

---

## 🛠️ If It Does Not Start

| Possible Cause | Fix |
|---|---|
| Dependencies not installed | Re-run step 2 |
| Wrong folder | Run `pwd` and confirm `package.json` is present |
| `.env` missing or not loaded | Check the file exists in the project root |
| Port `5173` in use | Vite will auto-suggest the next free port — check the terminal output |

---

# Running the API and the web app

The prototype above lives in `src/` and is left as it was. The delivered system is three folders
next to it:

| Folder | What it is |
|---|---|
| `shared/` | Roles, the permission table, the response envelope and the validation schemas. Used by both of the others |
| `api/` | The REEF API (Hono, TypeScript) at `http://localhost:8787`. Every request is checked for a valid sign-in and a permission |
| `web/` | The front end. Signs in with Supabase Auth, then asks the API who you are and what you may see |

## First time

`shared/` must be built before the other two can use it.

```bash
cd shared && npm install && npm run build && cd ..
cd api && npm install && cp .env.example .env && cd ..
cd web && npm install && cp .env.example .env && cd ..
```

Fill in both `.env` files with the Supabase project URL and publishable key. Neither file is
committed: both are in `.gitignore`.

## Every time

In two terminals:

```bash
cd api && npm run dev
```

```bash
cd web && npm run dev
```

Check the API with `http://localhost:8787/health`, which should answer `{"data":{"status":"ok"}}`.

## Checks before a pull request

From `api/`: `npm run typecheck`, `npm test`, and `npm run endpoints:check`. If you added or
changed a route, run `npm run endpoints` and commit the regenerated `docs/api-endpoints.md`.
