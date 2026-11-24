import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const [email, password, name = '말결 상담원'] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error('사용법: npm run partner:create -- counselor@example.com 12자이상비밀번호 [이름]');
  process.exit(1);
}
const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'rkx_consulting'
});
const [[existing]] = await db.execute('SELECT id FROM users WHERE email=?', [email.toLowerCase()]);
if (existing) { console.error('이미 등록된 이메일입니다. 기존 계정은 자동으로 역할을 변경하지 않습니다.'); await db.end(); process.exit(1); }
const passwordHash = await bcrypt.hash(password, 12);
await db.execute("INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,'partner')", [name, email.toLowerCase(), '', passwordHash]);
await db.end();
console.log(`말결 테스트 계정 설정 완료: ${email.toLowerCase()}`);
