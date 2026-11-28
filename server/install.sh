#!/usr/bin/env bash
# 自主学 · 一键部署 / 升级（Ubuntu 22.04 / 24.04，1 核 1G 就够）。在 DigitalOcean 网页控制台（Droplet Console）里用 root 执行：
#
#   curl -fsSL https://kelsonsun.github.io/zizhuxue/server/install.sh | bash
#
# 或者先把代码包传到服务器上（scp zizhuxue-server.tgz root@服务器IP:），再执行：  bash install.sh /root/zizhuxue-server.tgz
#
# 做的事：1G swap → 防火墙只开 22/80/443 → 安装 Node.js 22 和 Caddy → 解压代码到 /opt/zizhuxue →
#        生成 /etc/zizhuxue/zizhuxue.env（随机 ADMIN_TOKEN）→ systemd 服务 zizhuxue（只监听 127.0.0.1:8787）→
#        Caddy 自动 HTTPS（zizhuxue.com，www 跳转）→ 打印管理看板地址和口令。
# 重复执行 = 升级：代码换新版，数据库（/var/lib/zizhuxue）和配置（含口令）都保留。
# 说明：用 Node.js 22 而不是 20 —— 服务器用的是 Node 自带的 SQLite（node:sqlite），Node 22.13 起才有、不用额外参数。
set -euo pipefail

DOMAIN="${ZZX_DOMAIN:-zizhuxue.com}"
TARBALL_URL="${ZZX_TARBALL_URL:-https://kelsonsun.github.io/zizhuxue/server/zizhuxue-server.tgz}"
APP_DIR=/opt/zizhuxue
DATA_DIR=/var/lib/zizhuxue
ENV_DIR=/etc/zizhuxue
ENV_FILE=$ENV_DIR/zizhuxue.env
NODE_MIN=22.13.0

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[注意] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[失败] %s\033[0m\n' "$*" >&2; exit 1; }

# 整个脚本包在 main 里：用 curl | bash 执行时，bash 先读完全部内容再运行，中途不会被别的命令吃掉输入
main() {
[ "$(id -u)" = 0 ] || die "请用 root 执行（DigitalOcean 网页控制台默认就是 root；否则在命令前加 sudo）"
command -v apt-get >/dev/null || die "这个脚本只支持 Ubuntu / Debian"
export DEBIAN_FRONTEND=noninteractive

# ---------- 1. swap（1G 内存的机器装依赖、跑服务时防止内存不够被杀） ----------
if ! swapon --show=NAME --noheadings | grep -q .; then
  say "创建 1GB swap"
  if [ ! -f /swapfile ]; then fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none; fi
  chmod 600 /swapfile; mkswap /swapfile >/dev/null; swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10; echo 'vm.swappiness=10' > /etc/sysctl.d/99-zizhuxue-swap.conf
else
  say "已有 swap，跳过"
fi

# ---------- 2. 基础工具 + 防火墙 ----------
say "安装基础工具"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw tar sqlite3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null

say "防火墙：只开 22（SSH）、80、443"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null   # HTTP/3
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/    /'

# ---------- 3. Node.js 22 ----------
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }
NODE_V="$(node -v 2>/dev/null | sed 's/^v//' || true)"
if [ -z "$NODE_V" ] || ! ver_ge "$NODE_V" "$NODE_MIN"; then
  say "安装 Node.js 22（NodeSource 官方源）"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
NODE_V="$(node -v | sed 's/^v//')"
ver_ge "$NODE_V" "$NODE_MIN" || die "Node.js 版本 $NODE_V 太旧，需要 ≥ $NODE_MIN"
node -e "require('node:sqlite')" 2>/dev/null || die "这个 Node.js 没有内置 SQLite（node:sqlite）"
echo "    Node.js v$NODE_V"

# ---------- 4. Caddy ----------
if ! command -v caddy >/dev/null; then
  say "安装 Caddy（官方源）"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "    $(caddy version | head -1)"

# ---------- 5. 代码 ----------
id zizhuxue >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin zizhuxue
install -d -m 755 "$APP_DIR/releases"
install -d -m 750 -o zizhuxue -g zizhuxue "$DATA_DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [ -n "${1:-}" ]; then
  [ -f "$1" ] || die "找不到代码包：$1"
  say "使用本地代码包 $1"; cp "$1" "$TMP/app.tgz"
else
  say "下载代码包 $TARBALL_URL"
  curl -fsSL --retry 3 -o "$TMP/app.tgz" "$TARBALL_URL" || die "下载失败：$TARBALL_URL（GitHub Pages 上传好了吗？）"
  if curl -fsSL --retry 3 -o "$TMP/app.tgz.sha256" "$TARBALL_URL.sha256" 2>/dev/null; then
    [ "$(sha256sum "$TMP/app.tgz" | cut -d' ' -f1)" = "$(cut -d' ' -f1 < "$TMP/app.tgz.sha256")" ] || die "代码包校验不通过（sha256 不一致），可能没下载完整，请重试"
    echo "    sha256 校验通过"
  fi
fi
mkdir -p "$TMP/x"; tar -xzf "$TMP/app.tgz" -C "$TMP/x"
[ -f "$TMP/x/sync-server/server.js" ] || die "代码包内容不对（没有 sync-server/server.js）"
VER="$(node -p "require('$TMP/x/package.json').version")"
REL="$APP_DIR/releases/$VER-$(date +%Y%m%d%H%M%S)"
mv "$TMP/x" "$REL"; rm -f "$REL/sync-server/.env"; chown -R root:root "$REL"; chmod -R a+rX "$REL"
ln -sfn "$REL" "$APP_DIR/current"
ls -1dt "$APP_DIR"/releases/* | tail -n +4 | xargs -r rm -rf   # 只留最近 3 个版本，方便回滚
echo "    版本 $VER → $REL"

# ---------- 6. 配置（第一次生成；以后升级保留，不改口令） ----------
install -d -m 750 -o root -g zizhuxue "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  say "生成配置 $ENV_FILE（含随机管理口令）"
  TOKEN="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  cat > "$ENV_FILE" <<CONF
# 自主学服务器配置（改完执行：systemctl restart zizhuxue）。每项说明见 /opt/zizhuxue/current/sync-server/.env.example
PORT=8787
HOST=127.0.0.1
DB_FILE=$DATA_DIR/zizhuxue.db
PUBLIC_URL=https://$DOMAIN
ALLOWED_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://kelsonsun.github.io
TRUST_PROXY=1
SERVE_APP=1
# 云同步要发邮件验证码：SMTP 配好（MAIL_PROVIDER=smtp + SMTP_*）之后再改成 WEB_SYNC=1
WEB_SYNC=0
MAIL_PROVIDER=console
# 管理看板 https://$DOMAIN/admin/stats 的口令（也用于查看反馈、管理激活码）
ADMIN_TOKEN=$TOKEN
TELEMETRY_ENABLED=1
# 「今天」按美国中部时间切分：冬令时 -360（CST）；夏令时（3 月中到 11 月初）可改成 -300（CDT）
STATS_TZ_OFFSET_MIN=-360
FEEDBACK_EMAIL=
CONF
  chown root:zizhuxue "$ENV_FILE"; chmod 640 "$ENV_FILE"
else
  say "保留已有配置 $ENV_FILE"
fi
ADMIN_TOKEN_SHOW="$(grep -E '^ADMIN_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"

# ---------- 7. systemd 服务 ----------
say "启动服务 zizhuxue"
install -m 644 "$APP_DIR/current/sync-server/deploy/zizhuxue.service" /etc/systemd/system/zizhuxue.service
systemctl daemon-reload
systemctl enable zizhuxue >/dev/null 2>&1
systemctl restart zizhuxue
ok=0; for _ in $(seq 1 30); do if curl -fsS http://127.0.0.1:8787/healthz >/dev/null 2>&1; then ok=1; break; fi; sleep 1; done
[ $ok = 1 ] || { journalctl -u zizhuxue -n 40 --no-pager; die "服务没起来，上面是日志"; }
echo "    $(curl -fsS http://127.0.0.1:8787/healthz)"
PUSH_ON="$(curl -fsS http://127.0.0.1:8787/api/v1/health 2>/dev/null | grep -o '"push":true' || true)"
echo "    学习提醒推送（网页推送，VAPID 密钥首次启动自动生成并存在数据库里）：$( [ -n "$PUSH_ON" ] && echo '已开启' || echo '没开（检查 $ENV_FILE 里的 PUSH_ENABLED）' )"

# 每天凌晨 3 点在线备份数据库（保留 14 份，在 $DATA_DIR/backups）
cat > /etc/cron.d/zizhuxue-backup <<CRON
0 3 * * * zizhuxue cd $APP_DIR/current && set -a && . $ENV_FILE && set +a && BACKUP_KEEP=14 /usr/bin/node --disable-warning=ExperimentalWarning sync-server/backup.js >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/zizhuxue-backup

# ---------- 8. Caddy（自动 HTTPS） ----------
say "配置 Caddy：https://$DOMAIN（www 跳转到不带 www）"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q '自主学' /etc/caddy/Caddyfile; then cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"; fi
sed "s/zizhuxue\.com/$DOMAIN/g" "$APP_DIR/current/sync-server/deploy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; die "Caddyfile 有误"; }
systemctl enable caddy >/dev/null 2>&1; systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ---------- 9. 检查域名解析 ----------
MYIP="$(curl -fsS -m 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address 2>/dev/null || hostname -I | awk '{print $1}')"
for h in "$DOMAIN" "www.$DOMAIN"; do
  got="$(getent ahostsv4 "$h" 2>/dev/null | awk 'NR==1{print $1}')"
  if [ "$got" = "$MYIP" ]; then echo "    $h → $got ✓"
  else warn "$h 解析到「${got:-没有记录}」，不是本机 $MYIP。请在域名的 DNS（Cloudflare）里加 A 记录 $h → $MYIP，并设成「仅 DNS」（灰色云朵）。解析生效后 Caddy 会自动申请证书，不用重跑脚本。"; fi
done
HTTPS_OK=0; curl -fsS -m 10 -o /dev/null "https://$DOMAIN/healthz" 2>/dev/null && HTTPS_OK=1

cat <<DONE

==================================================================
 ✅ 自主学服务器已部署（版本 $VER）

 管理看板：  https://$DOMAIN/admin/stats
 管理口令：  $ADMIN_TOKEN_SHOW
            （请保存到密码管理器；忘了可以在服务器上看：grep ADMIN_TOKEN $ENV_FILE）
 网页版：    https://$DOMAIN/
 健康检查：  https://$DOMAIN/healthz
 HTTPS：     $( [ $HTTPS_OK = 1 ] && echo '已生效' || echo '还没生效（域名解析好后 1～2 分钟内 Caddy 自动申请证书；看进度：journalctl -u caddy -f）' )

 常用命令：  systemctl status zizhuxue      journalctl -u zizhuxue -f
            改配置：nano $ENV_FILE  然后  systemctl restart zizhuxue
            升级：再执行一遍同样的安装命令（数据和口令都保留）
            数据库：$DATA_DIR/zizhuxue.db   每日备份：$DATA_DIR/backups
==================================================================
DONE
}

main "$@"
