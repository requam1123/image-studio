/**
 * 密码验证模块
 *
 * 沿用 nginx htpasswd 文件的密码哈希（apache-md5 格式）。
 * 文件路径：/etc/nginx/.htpasswd_play（可由 .env.local HTPASSWD_FILE 覆盖）
 *
 * 验证方式：
 * 1. 读取 htpasswd 文件，逐行解析
 * 2. 找到对应用户名，获取密码哈希
 * 3. 使用 apache-md5 算法验证密码
 *
 * 这样用户信息与 nginx 共用一套，无需单独维护密码表。
 */

import ApacheMD5 from "apache-md5";
import fs from "fs";

const HTPASSWD_PATH =
  process.env.HTPASSWD_FILE || "/etc/nginx/.htpasswd_play";

/** 验证用户名密码，成功返回 true */
export function verifyHtpasswd(
  username: string,
  password: string
): boolean {
  try {
    const text = fs.readFileSync(HTPASSWD_PATH, "utf-8");
    for (const line of text.split("\n")) {
      const [user, hash] = line.trim().split(":");
      if (user === username && hash) {
        return hash === ApacheMD5(password, hash);
      }
    }
  } catch {
    // 文件不存在或不可读 → 验证失败
  }
  return false;
}
