#!/usr/bin/env node
/**
 * 三花的树洞 - 消息通知脚本
 * 定时检查新私信和通知，通过API发送到用户微信
 * 
 * 用法：node scripts/notify.js
 * 建议每5分钟执行一次（通过cron或heartbeat）
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'db'));

// 检查所有用户的未读消息
const users = db.prepare('SELECT id, username, nickname FROM users').all();

for (const user of users) {
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_user_id = ? AND is_read = 0').get(user.id).c;
  const notifCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE to_user_id = ? AND is_read = 0').get(user.id).c;
  const total = msgCount + notifCount;

  if (total > 0) {
    console.log(`[${new Date().toLocaleString('zh-CN')}] ${user.nickname}: ${total} 条未读（${msgCount} 私信 + ${notifCount} 通知）`);
    
    // 这里可以对接微信推送API
    // 目前先输出日志，后续可以配置
  }
}

console.log('✅ 通知检查完成');
