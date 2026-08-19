import * as db from './database.js';

async function main() {
  const default11 = ['노블루드', '악시오스', '바르시엔', '구루타', '카루카', '비슈베다', '쉬라크', '타르탄', '카샤파', '라그타', '가르투아'];
  console.log('🕒 11종 기본 보스의 최근 분석 기록 취소(롤백) 중...');
  
  for (const name of default11) {
    try {
      // Fetch the record to see if there is anything to rollback
      const record = await db.get('SELECT prev_last_kill, prev_next_spawn FROM records WHERE boss_name = ?', [name]);
      if (record && (record.prev_last_kill !== null || record.prev_next_spawn !== null)) {
        await db.rollbackRecord(name);
        console.log(`✅ ${name}: 이전 분석 시점의 기록으로 복구되었습니다.`);
      } else {
        // If there's no previous record, reset it to NULL to wipe the incorrect OCR spawn
        await db.run('UPDATE records SET last_kill = NULL, next_spawn = NULL, prev_last_kill = NULL, prev_next_spawn = NULL WHERE boss_name = ?', [name]);
        console.log(`🔄 ${name}: 이전 기록이 없어 공백 상태로 초기화되었습니다.`);
      }
    } catch (err) {
      console.log(`❌ ${name} 롤백 실패: ${err.message}`);
    }
  }
  
  console.log('🎉 롤백 작업이 완료되었습니다.');
  process.exit(0);
}

main();
