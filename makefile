# Carga el .env automáticamente si existe
ifneq (,$(wildcard .env))
  include .env
  export
endif

SST := npx sst
AWS_ARGS := AWS_PROFILE=$(AWS_PROFILE)

BRANCH_NAME := $(shell git rev-parse --abbrev-ref HEAD)

.PHONY: doctor sst-dev sst-local sst-deploy sst-remove sst-unlock sst-refresh sst-repair \
        git-push git-push-local git-push-dev git-push-test git-push-main \
        _guard_deploy _guard_env _guard_clean _guard_git

# ---------- Helpers ----------
define require_branch
	@if [ "$(BRANCH_NAME)" != "$(1)" ]; then \
	  echo "❌ Estás en '$(BRANCH_NAME)'. Cambia a '$(1)' para ejecutar este objetivo."; \
	  exit 1; \
	fi
endef

# Verifica entorno mínimo (solo AWS_PROFILE obligatorio; REGION es opcional)
_guard_env:
	@if [ -z "$(AWS_PROFILE)" ]; then \
	  echo "❌ AWS_PROFILE no está seteado. Define AWS_PROFILE en tu entorno o en .env"; \
	  exit 1; \
	fi

# Bloquea si hay cambios sin commit (se usará solo para dev/testing/production)
_guard_clean:
	@if [ -n "$$(git status --porcelain)" ]; then \
	  echo "❌ Tienes cambios sin commit. Haz commit o stash antes de continuar."; \
	  exit 1; \
	fi

# Verifica upstream y que no falte push (se usará solo para dev/testing/production)
_guard_git:
	@if ! git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then \
	  echo "❌ La rama '$(BRANCH_NAME)' no tiene upstream. Ejecuta: git push -u origin $(BRANCH_NAME)"; \
	  exit 1; \
	fi
	@if [ "$$(git rev-list --count @{u}..HEAD)" -ne 0 ]; then \
	  echo "❌ Tienes commits sin push en '$(BRANCH_NAME)'. Ejecuta: git push"; \
	  exit 1; \
	fi

# Guard principal para deploy/remove/acciones con stage
# ÚNICO parámetro manual requerido: STAGE (local|dev|testing|production)
_guard_deploy: _guard_env
	@if [ -z "$(STAGE)" ]; then \
	  echo "❌ STAGE no está seteado. Uso: make <sst-deploy|sst-remove|sst-unlock|sst-refresh> STAGE=<local|dev|testing|production>"; \
	  exit 1; \
	fi
	@case "$(BRANCH_NAME)" in \
	  local) [ "$(STAGE)" = "local" ] || { echo "En rama 'local' usa STAGE=local"; exit 1; } ;; \
	  dev)   [ "$(STAGE)" = "dev" ] || { echo "En rama 'dev' usa STAGE=dev"; exit 1; } ;; \
	  test)  [ "$(STAGE)" = "testing" ] || { echo "En rama 'test' usa STAGE=testing"; exit 1; } ;; \
	  main)  [ "$(STAGE)" = "production" ] || { echo "En rama 'main' usa STAGE=production"; exit 1; } ;; \
	  *)     echo "Solo puedes desplegar/eliminar desde 'local', 'dev', 'test' o 'main' (rama actual: '$(BRANCH_NAME)')."; exit 1 ;; \
	esac
	@if [ "$(STAGE)" = "local" ]; then \
	  echo "ℹ️ Modo local: se permiten cambios sin commit, sin upstream y sin push."; \
	else \
	  $(MAKE) _guard_clean; \
	  $(MAKE) _guard_git; \
	  if [ "$(STAGE)" = "production" ]; then \
	    read -r -p "⚠️ Vas a desplegar a PRODUCCIÓN. ¿Confirmas? (yes/NO): " ans; \
	    if [ "$$ans" != "yes" ]; then echo "Cancelado."; exit 1; fi; \
	  fi; \
	fi

# ---------- Chequeos rápidos ----------
doctor: _guard_env
	@command -v node >/dev/null 2>&1 || { echo "❌ Node.js no encontrado en PATH"; exit 1; }
	@command -v npx  >/dev/null 2>&1 || { echo "❌ npx no encontrado en PATH"; exit 1; }
	@command -v git  >/dev/null 2>&1 || { echo "❌ git no encontrado en PATH"; exit 1; }
	@echo "✅ Entorno OK. AWS_PROFILE=$(AWS_PROFILE)"

# ---------- Desarrollo local ----------
sst-dev:
	@$(AWS_ARGS) $(SST) dev --stage dev

# Dev server en stage 'local'
sst-local:
	@$(AWS_ARGS) $(SST) dev --stage local

# ---------- Deploy / Remove (solo pasas STAGE=...) ----------
sst-deploy: _guard_deploy
	@$(AWS_ARGS) $(SST) deploy --stage $(STAGE)

sst-remove: _guard_deploy
	@$(AWS_ARGS) $(SST) remove --stage $(STAGE)

sst-unlock: _guard_deploy
	@$(AWS_ARGS) $(SST) unlock --stage $(STAGE)

sst-refresh: _guard_deploy
	@$(AWS_ARGS) $(SST) refresh --stage $(STAGE)

sst-repair: _guard_env
	@$(AWS_ARGS) $(SST) state repair

# ---------- Git (prefijo git-...) ----------
# 'make git-push' empuja la rama actual al mismo nombre remoto,
# solo si la rama es local/dev/test/main.
git-push:
	@case "$(BRANCH_NAME)" in \
	  local|dev|test|main) ;; \
	  *) echo "Solo puedes usar 'make git-push' desde local/dev/test/main (rama actual: '$(BRANCH_NAME)')."; exit 1 ;; \
	esac
	@git push origin "$(BRANCH_NAME)"

git-push-local:
	$(call require_branch,local)
	@git push origin local

git-push-dev:
	$(call require_branch,dev)
	@git push origin dev

git-push-test:
	$(call require_branch,test)
	@git push origin test

git-push-main:
	$(call require_branch,main)
	@git push origin main