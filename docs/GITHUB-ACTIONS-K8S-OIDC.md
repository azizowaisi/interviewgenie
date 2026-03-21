# GitHub Actions → Kubernetes auth (OIDC vs kubeconfig)

This repo’s default **remote** deploy path uses a base64 **`KUBE_CONFIG`** secret (works well with **k3s** on a VM). For **EKS / GKE / AKS**, prefer **OIDC workload identity** so CI never stores long-lived cluster admin credentials in GitHub.

## What is already in the workflow

- Top-level `permissions` includes `id-token: write` so jobs *can* mint OIDC tokens.
- Deploy jobs still use `secrets.KUBE_CONFIG` unless you change them.

## AWS EKS (OIDC)

1. Create an IAM OIDC provider for GitHub (one-time): [AWS docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services).
2. IAM role trust policy: allow `token.actions.githubusercontent.com` for your repo (`repo:OWNER/REPO:ref:refs/heads/main`).
3. Attach a policy allowing `eks:DescribeCluster` and `sts:GetCallerIdentity` as needed, plus least-privilege for deploy (often a dedicated role used only with `kubectl` via `aws eks update-kubeconfig`).
4. In the workflow, before `kubectl`:

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::ACCOUNT_ID:role/GitHubActionsEKSDeploy
    aws-region: us-east-1
- run: aws eks update-kubeconfig --name YOUR_CLUSTER
```

Remove the “decode KUBE_CONFIG” step when using this path.

## Google GKE (Workload Identity Federation)

1. Create a WIF pool + provider for GitHub: [Google doc](https://github.com/google-github-actions/auth#workload-identity-federation-through-the-github-provider).
2. Bind a Kubernetes `RoleBinding` / `ClusterRoleBinding` to the federated principal.
3. Use `google-github-actions/auth@v2` + `google-github-actions/get-gke-credentials@v2` to obtain kubeconfig in the job.

## Azure AKS

Use `azure/login@v2` with federated credentials and `azure/aks-set-context@v3` (or `az aks get-credentials`).

## k3s / self-managed (no cloud IAM)

OIDC from GitHub does **not** map to Kubernetes RBAC without extra machinery (e.g. **Dex**, **Teleport**, **Vault** issuing short-lived certs). Practical options:

- Keep **`KUBE_CONFIG`** as a **short-lived** kubeconfig (rotate regularly), or
- Run deploy on a **self-hosted runner** on the node (already supported via `DEPLOY_MODE=self_hosted`).

## Rollback

If a rollout fails after an image pin:

```bash
kubectl rollout undo deployment/api-service -n interview-ai
```

See also: `scripts/ci/k8s-apply.sh` and `.github/workflows/build-and-deploy.yml`.
