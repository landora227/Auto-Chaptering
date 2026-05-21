# 视频切镜检测

在浏览器本地分析视频：先找 BGM 静音段，再在段内检测画面硬切，输出 25 fps 时间码。

## 在线访问

部署完成后，访问地址示例：

- **GitHub Pages**：`https://landora227.github.io/Auto-Chaptering/`
- **Netlify / Vercel**：控制台会显示分配的 `*.netlify.app` 或 `*.vercel.app` 域名

## 发布方式（任选其一）

### 方式 A：GitHub Pages（推荐，免费）

1. 在 [GitHub](https://github.com/new) 新建仓库 `Auto-Chaptering`（若尚未创建）
2. 在本目录执行：

```bash
cd shot-cut-detector
git branch -M main
git remote add origin https://github.com/landora227/Auto-Chaptering.git
git push -u origin main
```

3. 打开仓库 **Settings → Pages → Build and deployment**
   - Source 选 **GitHub Actions**
4. 等待 Actions 跑完（约 1 分钟），即可用 Pages 链接访问

### 方式 B：Netlify 拖拽（最快，无需命令行）

1. 打开 [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. 把整个 `shot-cut-detector` 文件夹拖进去
3. 获得 `https://随机名.netlify.app` 链接，可在控制台改自定义域名

### 方式 C：Vercel

1. 打开 [https://vercel.com/new](https://vercel.com/new)
2. 导入 GitHub 仓库，或 CLI：

```bash
npx vercel --prod
```

（Root Directory 选本文件夹，无需构建命令）

## 本地预览

- 双击 `打开本地预览.command`
- 或：`python3 -m http.server 8765` 后打开 `http://localhost:8765`

## 说明

- 视频在本地浏览器处理，不上传服务器
- 需使用 HTTPS 或 localhost，剪贴板复制才稳定
