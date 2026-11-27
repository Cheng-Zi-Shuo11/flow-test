#!/usr/bin/env bash
#
# 把 FlowTest 发布到 GitHub，并触发双平台构建
#
# 用法：
#   bash scripts/publish-github.sh              # 默认 public 仓库
#   VISIBILITY=private bash scripts/publish-github.sh
#   REPO_NAME=mytool bash scripts/publish-github.sh
#
# 前置条件：已执行 gh auth login（GitHub.com / HTTPS / web browser）

set -euo pipefail

REPO_NAME="${REPO_NAME:-flow-test}"
VISIBILITY="${VISIBILITY:-public}"
TAG="${TAG:-v0.1.0}"
BRANCH="main"

cd "$(dirname "$0")/.."

step() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[错误]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 登录检查 ----------
step "检查 GitHub 登录状态"
if ! gh auth status >/dev/null 2>&1; then
  fail "尚未登录。请先执行：gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow"
fi
OWNER="$(gh api user --jq .login)"
echo "    账号：$OWNER"

# ---------- 2. 提交检查 ----------
step "检查工作区"
if [ -n "$(git status --porcelain)" ]; then
  fail "工作区有未提交的改动，请先提交后再发布。"
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  fail "仓库还没有任何提交。"
fi
echo "    当前提交：$(git log --oneline -1)"

# ---------- 3. 统一分支名 ----------
if [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]; then
  step "把分支重命名为 $BRANCH"
  git branch -M "$BRANCH"
fi

# ---------- 4. 创建仓库 ----------
step "准备远程仓库 $OWNER/$REPO_NAME"
if gh repo view "$OWNER/$REPO_NAME" >/dev/null 2>&1; then
  echo "    仓库已存在，直接复用"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "https://github.com/$OWNER/$REPO_NAME.git"
  else
    git remote add origin "https://github.com/$OWNER/$REPO_NAME.git"
  fi
else
  gh repo create "$REPO_NAME" \
    --"$VISIBILITY" \
    --source . \
    --remote origin \
    --description "通用自动化 UI 测试平台：用自然语言描述操作流程，自动执行并生成报告" \
    --disable-wiki
fi

# ---------- 5. 推送代码 ----------
step "推送 $BRANCH 分支"
git push -u origin "$BRANCH"

# ---------- 6. 打 tag 触发构建 ----------
step "打 tag $TAG 并推送（触发双平台构建）"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "    tag 已存在，跳过创建"
else
  git tag -a "$TAG" -m "FlowTest $TAG"
fi
git push origin "$TAG"

# ---------- 7. 结果 ----------
printf '\n'
step "完成"
echo "    仓库：  https://github.com/$OWNER/$REPO_NAME"
echo "    Actions：https://github.com/$OWNER/$REPO_NAME/actions"
echo "    构建完成后安装包会出现在 Releases 页面："
echo "            https://github.com/$OWNER/$REPO_NAME/releases/tag/$TAG"
