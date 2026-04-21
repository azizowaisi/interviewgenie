# k3s: rolling updates, “zero downtime”, and autoscaling

## What Kubernetes can (and cannot) do on one VM

| Goal | On a **single** k3s node | With **multiple** nodes / bigger VM |
|------|---------------------------|-------------------------------------|
| **Rolling deploys** | Yes — new pods replace old ones in order | Yes |
| **No dropped requests** | Best effort: **readiness probes** + **Service** only send traffic to Ready pods | Better with more capacity |
| **Autoscale pods (HPA)** | Yes — **within** CPU/RAM of the one node | Same, but more headroom |
| **Autoscale the server (new VMs)** | **No** — k3s does not create Oracle/AWS instances | Use your cloud’s **node pool autoscaler** + cluster autoscaler |

**HPA** changes **replica counts** for Deployments. It does **not** increase the physical size of your Oracle VM. If traffic grows beyond what one machine can run, add RAM/CPU, add agent nodes, or move heavy work (e.g. Ollama) off-cluster.

**Oracle Cloud (OKE) / Flex:** To **autoscale the pool of worker nodes** when pods are unschedulable, use **Cluster Autoscaler** + a **node pool** with min/max node counts — that adds **new VMs**, unlike HPA. **VM.Standard.A1.Flex** also allows **vertical resize** (more OCPUs/RAM on the same instance) in the console; restart/reconcile workloads after resize.

---

## Readiness + rolling strategy (this repo)

- **Stateless** Deployments (`audio`, `stt`, `question`, `llm`, `formatter`):  
  `maxUnavailable: 0`, `maxSurge: 1` → Kubernetes may run **two** pods briefly during a rollout so the Service can shift traffic to the new pod before terminating the old one (when the node has enough CPU/RAM).

- **api-service** and **ollama** use **ReadWriteOnce** PVCs (`local-path` on k3s). Only **one** pod can mount that volume at a time, so we use **`maxSurge: 0`**, **`maxUnavailable: 1`**. Deployments still roll safely, but there can be a **short window** where the old pod is gone and the new one is starting. **Readiness probes** minimize wrong routing; for true HA on uploads, use **RWX** storage or object storage (S3) and then you can use `maxSurge: 1` + optional HPA for `api-service`.

- **preStop sleep** (where used): gives Traefik/kube-proxy time to stop sending new connections before the process exits.

---

## HorizontalPodAutoscaler (HPA)

Manifests: `k8s/hpa/stateless-services.yaml`

- Targets: `audio-service`, `stt-service`, `question-service`, `llm-service`, `formatter-service`, and **`api-service` with `maxReplicas: 1`** on the default **single-node + RWO uploads** install (extra api pods would stay Pending).
- **Not** meaningful multi-replica: **ollama** (RWO model PVC — one pod). To scale **api** horizontally, fix storage first (RWX / S3), then raise **api-service** `maxReplicas` in `k8s/hpa/stateless-services.yaml`.
- Requires **metrics-server**. On k3s:

  ```bash
  kubectl get apiservice v1beta1.metrics.k8s.io -o wide
  kubectl top nodes
  kubectl top pods -n interview-ai
  ```

- **Tune `maxReplicas`** to your machine: if extra pods stay `Pending`, lower caps or increase VM resources.

  Example (very rough):  
  `max_replicas ≤ floor(node_allocatable_cpu / pod_cpu_request)` for the heaviest service.

---

## Verifying a rollout

```bash
kubectl rollout status deployment/api-service -n interview-ai
kubectl get pods -n interview-ai -w
```

---

## Optional next steps

1. **Second k3s agent node** — more room for surges and HPA.
2. **RWX / S3 for CVs** — unlock rolling surge + HPA for `api-service`.
3. **PodDisruptionBudgets** — meaningful when `minReplicas ≥ 2` for a Deployment.
4. **VPA** — vertical autoscaling (advanced, separate install).
