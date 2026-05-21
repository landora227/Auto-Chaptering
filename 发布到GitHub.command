#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo "  视频切镜检测 · 发布到 GitHub Pages"
echo "=========================================="
echo ""
echo "请先在 github.com 创建空仓库，例如：shot-cut-detector"
echo ""
read -p "你的 GitHub 用户名: " GH_USER
read -p "仓库名（默认 shot-cut-detector）: " GH_REPO
GH_REPO=${GH_REPO:-shot-cut-detector}

if ! command -v git &>/dev/null; then
  echo "未找到 git，请先安装 Xcode Command Line Tools"
  exit 1
fi

git init 2>/dev/null || true
git add .
git commit -m "发布视频切镜检测工具" 2>/dev/null || git commit --amend -m "发布视频切镜检测工具" 2>/dev/null || true
git branch -M main
git remote remove origin 2>/dev/null
git remote add origin "https://github.com/${GH_USER}/${GH_REPO}.git"

echo ""
echo "正在推送…（可能需要登录 GitHub）"
git push -u origin main

echo ""
echo "推送完成后，到仓库 Settings → Pages → Source 选 GitHub Actions"
echo "部署成功后访问："
echo "  https://${GH_USER}.github.io/${GH_REPO}/"
echo ""
read -p "按回车关闭…"
