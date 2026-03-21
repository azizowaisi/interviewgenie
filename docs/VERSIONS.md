# Runtime & image versions (policy)

Pinned as of the last dependency refresh. **Ubuntu** is used for **Python** service images; **Node** stages use **official Node Alpine** (not Ubuntu — there is no official `node:*-ubuntu24` image from Docker Hub).

| Area | Choice | Notes |
|------|--------|--------|
| **Python services (Docker)** | `ubuntu:24.04` + `python3` venv | Noble LTS; deps via `/opt/venv` + `pip`. |
| **Node / Next / Vite (Docker)** | `node:22-alpine` | Node **22** LTS; smaller than Ubuntu+Node install. |
| **GitHub Actions** | `runs-on: ubuntu-24.04` | Matches Noble; **Python 3.12** in `setup-python`. |
| **MongoDB (compose / k8s)** | `mongo:8` | Latest stable major on Docker Hub `mongo` image. |
| **Ollama** | `ollama/ollama:latest` | Pin a digest in production if you need reproducibility. |

Application libraries: see root `web/package.json`, `clients/electron-app/package.json`, Vue `frontend/package.json` files, and each `backend/*/requirements.txt`. Re-check with:

```bash
npm audit
pip install pip-audit && pip-audit -r backend/api-service/requirements.txt
```
