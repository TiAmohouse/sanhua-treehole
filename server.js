const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'sanhua-treehole-secret-key-2026',
  resave: false,
  saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

// ============ API ============

// 注册
app.post('/api/register', (req, res) => {
  const { username, password, nickname, phone } = req.body;
  if (!username || !password) return res.json({ ok: false, msg: '用户名和密码不能为空' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password, nickname, phone) VALUES (?, ?, ?, ?)').run(username, hash, nickname || username, phone || null);
    res.json({ ok: true, msg: '注册成功！' });
  } catch (e) {
    res.json({ ok: false, msg: '用户名已存在' });
  }
});

// 登录（用户名或手机号）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // 支持用户名或手机号登录
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?').get(username, username);
  if (!user) return res.json({ ok: false, msg: '用户名/手机号不存在' });
  if (!bcrypt.compareSync(password, user.password)) return res.json({ ok: false, msg: '密码错误' });
  req.session.user = { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar };
  res.json({ ok: true, user: req.session.user });
});

// 退出
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// 当前用户
app.get('/api/me', (req, res) => {
  if (req.session.user) {
    const user = db.prepare('SELECT id, username, nickname, avatar, bio, phone, created_at FROM users WHERE id = ?').get(req.session.user.id);
    res.json({ ok: true, user });
  } else {
    res.json({ ok: false });
  }
});

// 三花的日记（站长公开日记）
app.get('/api/sanhua', (req, res) => {
  const posts = db.prepare("SELECT p.*, u.nickname, u.avatar FROM posts p JOIN users u ON p.user_id = u.id WHERE p.is_sanhua = 1 AND p.is_public = 1 ORDER BY p.created_at DESC").all();
  res.json({ ok: true, posts });
});

// 公共广场
app.get('/api/public', (req, res) => {
  const posts = db.prepare("SELECT p.*, u.nickname, u.avatar FROM posts p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 AND p.is_sanhua = 0 ORDER BY p.created_at DESC").all();
  res.json({ ok: true, posts });
});

// 某人的空间
app.get('/api/space/:userId', (req, res) => {
  const owner = db.prepare('SELECT id, username, nickname, avatar, bio, created_at FROM users WHERE id = ?').get(req.params.userId);
  if (!owner) return res.json({ ok: false, msg: '用户不存在' });
  
  let posts;
  if (req.session.user && req.session.user.id == req.params.userId) {
    // 自己的空间可以看到私密内容
    posts = db.prepare("SELECT p.*, u.nickname, u.avatar FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ? ORDER BY p.created_at DESC").all(req.params.userId);
  } else {
    posts = db.prepare("SELECT p.*, u.nickname, u.avatar FROM posts p JOIN users u ON p.user_id = u.id WHERE p.user_id = ? AND p.is_public = 1 ORDER BY p.created_at DESC").all(req.params.userId);
  }
  
  res.json({ ok: true, owner, posts });
});

// 写日记/吐槽
app.post('/api/post', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { title, content, is_public } = req.body;
  if (!content) return res.json({ ok: false, msg: '内容不能为空' });
  db.prepare('INSERT INTO posts (user_id, title, content, is_public) VALUES (?, ?, ?, ?)').run(req.session.user.id, title || '', content, is_public ? 1 : 0);
  res.json({ ok: true });
});

// 删除自己的帖子
app.post('/api/post/delete/:id', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!post) return res.json({ ok: false, msg: '无权删除' });
  // 先删除关联的评论、点赞
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM likes WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// 评论
app.post('/api/comment', (req, res) => {
  const { post_id, content } = req.body;
  if (!content) return res.json({ ok: false, msg: '内容不能为空' });
  const nickname = req.session.user ? req.session.user.nickname : '匿名路过';
  db.prepare('INSERT INTO comments (post_id, user_id, nickname, content) VALUES (?, ?, ?, ?)').run(post_id, req.session.user?.id || null, nickname, content);
  res.json({ ok: true });
});

// 绑定手机号
app.post('/api/bind-phone', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { phone } = req.body;
  if (!phone) return res.json({ ok: false, msg: '手机号不能为空' });
  // 检查手机号是否已被其他人绑定
  const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.session.user.id);
  if (existing) return res.json({ ok: false, msg: '该手机号已被绑定' });
  db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, req.session.user.id);
  res.json({ ok: true, msg: '绑定成功' });
});

// 帖子详情（含评论）
app.get('/api/post/:id', (req, res) => {
  const post = db.prepare("SELECT p.*, u.nickname, u.avatar FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?").get(req.params.id);
  if (!post) return res.json({ ok: false, msg: '不存在' });
  const comments = db.prepare("SELECT c.* FROM comments c WHERE c.post_id = ? ORDER BY c.created_at ASC").all(req.params.id);
  res.json({ ok: true, post, comments });
});

// ============ 好友 & 私信 ============

// 发送私信（第一句，50字限制）
app.post('/api/message/send', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { to_user_id, content } = req.body;
  if (!to_user_id || !content) return res.json({ ok: false, msg: '参数不完整' });
  if (content.length > 50) return res.json({ ok: false, msg: '一句话不能超过50字' });
  if (to_user_id == req.session.user.id) return res.json({ ok: false, msg: '不能给自己发私信' });

  // 检查是否已经是好友（好友之间不限次数）
  const isFriend = db.prepare('SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?').get(req.session.user.id, to_user_id);
  
  if (!isFriend) {
    // 非好友：检查是否发过第一句
    const existing = db.prepare('SELECT id FROM messages WHERE from_user_id = ? AND to_user_id = ? AND is_first_message = 1').get(req.session.user.id, to_user_id);
    if (existing) return res.json({ ok: false, msg: '你已经发过邀请消息了，等对方回复吧～' });
    
    db.prepare('INSERT INTO messages (from_user_id, to_user_id, content, is_first_message) VALUES (?, ?, ?, 1)').run(req.session.user.id, to_user_id, content);
    return res.json({ ok: true, msg: '私信已发送，等待对方回应～' });
  }

  // 好友之间正常发消息
  db.prepare('INSERT INTO messages (from_user_id, to_user_id, content, chat_accepted) VALUES (?, ?, ?, 1)').run(req.session.user.id, to_user_id, content);
  res.json({ ok: true, msg: '消息已发送' });
});

// 获取私信列表（收件箱）
app.get('/api/messages/inbox', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const userId = req.session.user.id;
  
  // 获取所有和当前用户有关的对话（按对方用户分组，取最新一条）
  const conversations = db.prepare(
    "SELECT CASE WHEN m.from_user_id = ? THEN m.to_user_id ELSE m.from_user_id END AS other_user_id, " +
    "m.content, m.is_read, m.chat_accepted, m.is_first_message, m.created_at, m.id as last_msg_id " +
    "FROM messages m WHERE m.from_user_id = ? OR m.to_user_id = ? " +
    "GROUP BY other_user_id ORDER BY m.created_at DESC"
  ).all(userId, userId, userId);

  // 补充对方用户信息（匿名保护）
  const result = conversations.map(c => {
    const otherUser = db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(c.other_user_id);
    
    return {
      other_user_id: c.other_user_id,
      nickname: otherUser?.nickname || '未知用户',
      avatar: otherUser?.avatar || '😺',
      last_msg: c.content,
      last_msg_time: c.created_at,
      is_read: c.is_read,
      chat_accepted: c.chat_accepted,
      is_first_message: c.is_first_message,
      last_msg_id: c.last_msg_id
    };
  });

  res.json({ ok: true, conversations: result });
});

// 获取和某人的聊天记录
app.get('/api/messages/chat/:userId', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const userId = req.session.user.id;
  const otherId = req.params.userId;

  const messages = db.prepare(
    "SELECT m.* FROM messages m WHERE (m.from_user_id = ? AND m.to_user_id = ?) " +
    "OR (m.from_user_id = ? AND m.to_user_id = ?) ORDER BY m.created_at ASC"
  ).all(userId, otherId, otherId, userId);

  // 将未读消息标记为已读
  db.prepare('UPDATE messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0').run(otherId, userId);

  // 对方信息（匿名保护）
  const otherUser = db.prepare('SELECT id, nickname, avatar FROM users WHERE id = ?').get(otherId);

  res.json({
    ok: true,
    messages: messages.map(m => ({
      id: m.id,
      from_user_id: m.from_user_id == userId ? userId : otherId,
      content: m.content,
      is_first_message: m.is_first_message,
      chat_accepted: m.chat_accepted,
      created_at: m.created_at,
      is_mine: m.from_user_id == userId
    })),
    other_user: {
      id: otherUser.id,
      nickname: otherUser.nickname,
      avatar: otherUser.avatar
    }
  });
});

// 接受聊天（确认第一句私信）
app.post('/api/message/accept/:msgId', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND to_user_id = ?').get(req.params.msgId, req.session.user.id);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  
  db.prepare('UPDATE messages SET chat_accepted = 1 WHERE id = ?').run(req.params.msgId);
  
  // 同时加为好友
  db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)').run(req.session.user.id, msg.from_user_id);
  db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)').run(msg.from_user_id, req.session.user.id);
  
  res.json({ ok: true, msg: '已接受聊天，现在可以自由对话了！' });
});

// 拒绝聊天
app.post('/api/message/reject/:msgId', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND to_user_id = ?').get(req.params.msgId, req.session.user.id);
  if (!msg) return res.json({ ok: false, msg: '消息不存在' });
  
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.msgId);
  
  res.json({ ok: true, msg: '已忽略该消息' });
});

// 获取好友列表（含备注）
app.get('/api/friends', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const userId = req.session.user.id;
  const friends = db.prepare(
    "SELECT u.id, u.nickname, u.avatar, f.note FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?"
  ).all(userId);
  res.json({ ok: true, friends });
});

// 设置好友备注
app.post('/api/friends/note', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { friend_id, note } = req.body;
  if (!friend_id) return res.json({ ok: false, msg: '参数不完整' });
  db.prepare('UPDATE friendships SET note = ? WHERE user_id = ? AND friend_id = ?').run(note || null, req.session.user.id, friend_id);
  res.json({ ok: true, msg: '备注已保存' });
});

// ============ 点赞 ============

// 点赞/取消点赞
app.post('/api/like/toggle', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { post_id } = req.body;
  if (!post_id) return res.json({ ok: false, msg: '参数不完整' });
  
  const existing = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(post_id, req.session.user.id);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    return res.json({ ok: true, liked: false });
  }
  
  db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(post_id, req.session.user.id);
  
  // 获取帖子主人，如果不是自己点的，发一条通知消息
  const post = db.prepare('SELECT user_id FROM posts WHERE id = ?').get(post_id);
  if (post && post.user_id != req.session.user.id) {
    const user = db.prepare('SELECT nickname FROM users WHERE id = ?').get(req.session.user.id);
    db.prepare('INSERT INTO notifications (to_user_id, from_user_id, type, post_id, content) VALUES (?, ?, ?, ?, ?)').run(
      post.user_id, req.session.user.id, 'like', post_id,
      '❤️ ' + (user.nickname || '某人') + ' 赞了你的帖子'
    );
  }
  
  res.json({ ok: true, liked: true });
});

// 帖子点赞数+是否已赞
app.get('/api/like/status', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const postIds = (req.query.ids || '').split(',').filter(Boolean);
  if (postIds.length === 0) return res.json({ ok: true, likes: {} });
  
  const result = {};
  for (const pid of postIds) {
    const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id = ?').get(pid);
    const liked = db.prepare('SELECT id FROM likes WHERE post_id = ? AND user_id = ?').get(pid, req.session.user.id);
    result[pid] = { count: count.c, liked: !!liked };
  }
  res.json({ ok: true, likes: result });
});

// ============ 通知系统 ============

// 创建通知表
(() => {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS notifications (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      to_user_id INTEGER NOT NULL,\n      from_user_id INTEGER,\n      type TEXT NOT NULL,\n      post_id INTEGER,\n      content TEXT NOT NULL,\n      is_read INTEGER DEFAULT 0,\n      created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n    )");
  } catch(e) {}
})();

// 未读消息总数（私信+通知）
app.get('/api/messages/unread-count', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_user_id = ? AND is_read = 0').get(req.session.user.id);
  const notifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE to_user_id = ? AND is_read = 0').get(req.session.user.id);
  res.json({ ok: true, count: msgCount.c + notifCount.c });
});

// 获取通知列表
app.get('/api/notifications', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const notifs = db.prepare(
    "SELECT n.*, u.nickname as from_nickname, u.avatar as from_avatar FROM notifications n LEFT JOIN users u ON u.id = n.from_user_id WHERE n.to_user_id = ? ORDER BY n.created_at DESC LIMIT 50"
  ).all(req.session.user.id);
  
  // 标记已读
  db.prepare('UPDATE notifications SET is_read = 1 WHERE to_user_id = ? AND is_read = 0').run(req.session.user.id);
  
  res.json({ ok: true, notifications: notifs });
});

// 获取所有用户（公共广场展示）

// 保存用户自定义背景图
app.post('/api/user/bg', (req, res) => {
  if (!req.session.user) return res.json({ ok: false, msg: '请先登录' });
  const { bg_image } = req.body;
  db.prepare('UPDATE users SET bg_image = ? WHERE id = ?').run(bg_image || null, req.session.user.id);
  res.json({ ok: true, msg: '背景图已更新' });
});

// 获取所有用户（公共广场展示）
app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, username, nickname, avatar, bio, phone FROM users ORDER BY id').all();
  res.json({ ok: true, users });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌸 三花的树洞已开放 → http://localhost:${PORT}`);
});
