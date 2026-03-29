# Auth0 stuck for days — end-to-end fix (Interview Genie)

If login or **Save Job** has failed for **48–72 hours**, you are usually hitting **one or both** of these:

1. **`AUTH0_AUDIENCE` is empty inside the `web` and/or `api-service` pods** (Kubernetes secret missing that key or pods not restarted).
2. **`api-service` is still running an old Docker image** that returns the legacy error *“AUTH0_AUDIENCE is required when AUTH0_DOMAIN is set”* (fixed in git commit **`f686c2e`** — but the cluster must run an image **built after** that commit).

Do the steps **in order**. Most teams unblock at **§2**.

---

## 0. One value from Auth0 (5 minutes)

1. Auth0 Dashboard → **Applications → APIs** → open your API (or **Create API** if none).
2. Copy the **Identifier** (URL-style string). Example: `https://interviewgenie.api` — **this exact string is `AUTH0_AUDIENCE` everywhere.**

Your **Regular Web Application** must have callback URLs like:

`https://YOUR_SITE/auth/callback` and locally `http://localhost:3002/auth/callback`.

---

## 1. Confirm the problem on the cluster (2 minutes)

With `kubectl` pointed at the right cluster (`namespace: interview-ai`):

```bash
K=interview-ai
API=$(kubectl get pod -n "$K" -l app=api-service -o jsonpath='{.items[0].metadata.name}')
WEB=$(kubectl get pod -n "$K" -l app=web -o jsonpath='{.items[0].metadata.name}')

kubectl exec -n "$K" "$API" -- sh -c 'echo api AUTH0_AUDIENCE_len=${#AUTH0_AUDIENCE} AUTH0_CLIENT_ID_len=${#AUTH0_CLIENT_ID}'
kubectl exec -n "$K" "$WEB" -- sh -c 'echo web AUTH0_AUDIENCE_len=${#AUTH0_AUDIENCE} AUTH0_CLIENT_ID_len=${#AUTH0_CLIENT_ID}'
```

- If **`AUTH0_AUDIENCE_len=0`** on **api** → **§2 is mandatory.**
- If **web** also has **`0`** → add the same key for the BFF (`getAccessToken({ audience })`).

Check whether **api-service** still ships the **old** error string (if this prints a match, the image is too old until **§3**):

```bash
kubectl exec -n "$K" deploy/api-service -- grep -F "AUTH0_AUDIENCE is required when AUTH0_DOMAIN" /app/auth.py && echo "OLD_IMAGE" || echo "ok_newer_image"
```

---

## 2. Put `AUTH0_AUDIENCE` in `web-auth0-env` and restart (5 minutes)

**Replace the placeholder** with your real API Identifier from §0.

```bash
K=interview-ai
AUD="https://YOUR_API_IDENTIFIER_FROM_AUTH0"

kubectl patch secret web-auth0-env -n "$K" --type=merge -p "{\"stringData\":{\"AUTH0_AUDIENCE\":\"$AUD\"}}"
kubectl rollout restart deployment/web deployment/api-service -n "$K"
kubectl rollout status deployment/api-service -n "$K" --timeout=180s
kubectl rollout status deployment/web -n "$K" --timeout=180s
```

Re-run **§1**. **`AUTH0_AUDIENCE_len`** must be **greater than 0** on **api** (and ideally **web**).

**Important:** `web-auth0-env` must **also** contain the other keys (see **`docs/GITHUB-ENVIRONMENT.md`**). Patching only adds/overrides **`AUTH0_AUDIENCE`**; it does not delete other keys.

---

## 3. Deploy a new `api-service` image (if §1 showed `OLD_IMAGE`)

1. GitHub → **Actions** → **Build and Deploy** on **`main`** → ensure the latest run **succeeded** and pushed **`interview-ai-api-service`**.
2. Note the **full** commit SHA of that run (40 hex chars). Image tag format: **`sha-<FULL_SHA>`** (same as in your workflow).
3. On the cluster, **only after** the image exists on Docker Hub:

```bash
K=interview-ai
SHA='<paste_full_40_char_commit_sha>'
kubectl set image -n "$K" deployment/api-service api-service=azizowaisi/interview-ai-api-service:sha-${SHA}
kubectl rollout status deployment/api-service -n "$K" --timeout=180s
```

If you see **ImagePullBackOff**, the tag does **not** exist yet — **do not** leave the deployment broken; **`kubectl rollout undo deployment/api-service -n interview-ai`**.

---

## 4. Browser check

1. Hard refresh, **log out**, **log in** again.
2. DevTools → **Network** → **Save Job** → `POST /api/app/topics` should be **200** (or **201**), not **401** / **503**.

---

## 5. Still broken — collect this and open an issue (or paste to chat)

```bash
K=interview-ai
kubectl get deploy -n "$K" web api-service -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.spec.containers[0].image}{"\n"}{end}'
kubectl logs -n "$K" deploy/web --tail=80
kubectl logs -n "$K" deploy/api-service --tail=80
```

Redact secrets; lengths from §1 are enough for env debugging.

---

## Why this drags on for days

- **Secret optional in YAML:** `AUTH0_AUDIENCE` comes from **`web-auth0-env`** with **`optional: true`**, so a **missing key** still schedules pods — they just get an **empty** audience and the API misbehaves.
- **Immutable image tags:** production is pinned to **`sha-…`**; editing git does nothing until **CI pushes** a new tag and you **roll** to it.
- **Two services:** **web** (BFF) and **api-service** must **agree** on audience and client id.

Longer setup context: **`docs/AUTH0-WEBSITE.md`**. CI variables: **`docs/GITHUB-ENVIRONMENT.md`**.
