import 'dotenv/config';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--yes')) {
  console.error('사용법: npm run accounts:clear [-- --yes]');
  process.exit(1);
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'rkx_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rkx_consulting'
});

try {
  const [[accounts]] = await db.query("SELECT COUNT(*) AS total FROM users WHERE role='customer'");
  const [[signups]] = await db.query('SELECT COUNT(*) AS total FROM signup_requests');
  const [recordings] = await db.query("SELECT r.file_name FROM recordings r JOIN tickets t ON t.id=r.ticket_id JOIN users u ON u.id=t.user_id WHERE u.role='customer' AND r.deleted_at IS NULL");
  console.log(`삭제 대상: 회원 계정 ${accounts.total}건, 가입 신청 ${signups.total}건, 녹취 파일 ${recordings.length}건`);
  if (!args.includes('--yes')) {
    console.log('삭제하려면 npm run accounts:clear -- --yes 를 실행하세요.');
  } else {
    await db.beginTransaction();
    let deletedAccounts, deletedSignups;
    try {
      [deletedSignups] = await db.execute('DELETE FROM signup_requests');
      [deletedAccounts] = await db.execute("DELETE FROM users WHERE role='customer'");
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }

    const recordingDir = fileURLToPath(new URL('../uploads/recordings/', import.meta.url));
    let fileFailures = 0;
    for (const { file_name: fileName } of recordings) {
      if (!/^[a-f0-9-]{36}\.(?:wav|webm|mp3|m4a)$/i.test(fileName) || path.basename(fileName) !== fileName) {
        fileFailures++;
        continue;
      }
      try {
        await unlink(path.join(recordingDir, fileName));
      } catch (error) {
        if (error.code !== 'ENOENT') fileFailures++;
      }
    }

    const [[remainingAccounts]] = await db.query("SELECT COUNT(*) AS total FROM users WHERE role='customer'");
    const [[remainingSignups]] = await db.query('SELECT COUNT(*) AS total FROM signup_requests');
    console.log(`삭제 완료: 회원 계정 ${deletedAccounts.affectedRows}건, 가입 신청 ${deletedSignups.affectedRows}건`);
    console.log(`남은 건수: 회원 계정 ${remainingAccounts.total}건, 가입 신청 ${remainingSignups.total}건`);
    if (fileFailures) {
      console.error(`녹취 파일 ${fileFailures}건은 삭제하지 못했습니다. uploads/recordings 폴더를 확인하세요.`);
      process.exitCode = 1;
    }
  }
} finally {
  await db.end();
}
