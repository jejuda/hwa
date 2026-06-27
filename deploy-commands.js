import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Error: DISCORD_TOKEN and CLIENT_ID must be specified in the .env file.');
  process.exit(1);
}

const BOSS_CHOICES = [
  { name: '노블루드 (4시간)', value: '노블루드' },
  { name: '악시오스 (4시간)', value: '악시오스' },
  { name: '바르시엔 (4시간)', value: '바르시엔' },
  { name: '구루타 (6시간)', value: '구루타' },
  { name: '카루카 (4시간)', value: '카루카' },
  { name: '비슈베다 (6시간)', value: '비슈베다' },
  { name: '쉬라크 (6시간)', value: '쉬라크' },
  { name: '타르탄 (6시간)', value: '타르탄' },
  { name: '카샤파 (6시간)', value: '카샤파' },
  { name: '라그타 (12시간)', value: '라그타' },
  { name: '가르투아 (12시간)', value: '가르투아' }
];

const commands = [
  // /보스수정 [이름] [젠주기] [메모]
  new SlashCommandBuilder()
    .setName('보스수정')
    .setDescription('등록된 보스의 정보를 수정합니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('보스 이름을 선택하세요.')
        .setRequired(true)
        .addChoices(...BOSS_CHOICES)
    )
    .addNumberOption(option =>
      option.setName('젠주기')
        .setDescription('새로운 젠 주기(시간)를 입력하세요.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('메모')
        .setDescription('새로운 메모를 입력하세요.')
        .setRequired(false)
    ),

  // /보스목록
  new SlashCommandBuilder()
    .setName('보스목록')
    .setDescription('등록된 모든 보스의 젠 시간 상태를 보여줍니다.'),

  // /보탐 (보스목록의 단축 명령어)
  new SlashCommandBuilder()
    .setName('보탐')
    .setDescription('등록된 모든 보스의 젠 시간 상태를 보여줍니다.'),

  // /보스순서
  new SlashCommandBuilder()
    .setName('보스순서')
    .setDescription('남은 시간이 적게 남은 순서대로 보스 목록을 나열합니다.'),

  // /컷 [이름] [시간]
  new SlashCommandBuilder()
    .setName('컷')
    .setDescription('보스 처치(컷) 시간을 기록합니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('보스 이름을 선택하세요.')
        .setRequired(true)
        .addChoices(...BOSS_CHOICES)
    )
    .addStringOption(option =>
      option.setName('시간')
        .setDescription('처치한 시간(HH:MM) 또는 "몇분전" 형태로 입력하세요. (예: 14:30, 10분전, 생략시 현재시간)')
        .setRequired(false)
    ),

  // /젠 [이름] [시간]
  new SlashCommandBuilder()
    .setName('젠')
    .setDescription('다음 보스 젠 예정 시간을 직접 기록합니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('보스 이름을 선택하세요.')
        .setRequired(true)
        .addChoices(...BOSS_CHOICES)
    )
    .addStringOption(option =>
      option.setName('시간')
        .setDescription('다음 젠 예정 시간(HH:MM)을 입력하세요. (예: 18:45)')
        .setRequired(true)
    ),

  // /컷취소 [이름]
  new SlashCommandBuilder()
    .setName('컷취소')
    .setDescription('보스의 최근 처치/젠 기록을 취소하고 이전 상태로 되돌립니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('보스 이름을 선택하세요.')
        .setRequired(true)
        .addChoices(...BOSS_CHOICES)
    ),

  // /알림채널설정 [채널]
  new SlashCommandBuilder()
    .setName('알림채널설정')
    .setDescription('보스 젠 알림을 받을 채널을 설정합니다.')
    .addChannelOption(option =>
      option.setName('채널')
        .setDescription('알림을 받을 채널을 지정하세요. (생략시 현재 채널)')
        .setRequired(false)
    ),

  // /알림채널확인
  new SlashCommandBuilder()
    .setName('알림채널확인')
    .setDescription('현재 설정된 보스 젠 알림 채널을 확인합니다.'),

  // /음성채널설정 [채널]
  new SlashCommandBuilder()
    .setName('음성채널설정')
    .setDescription('5분 전 TTS 알림을 들을 음성 채널을 지정합니다.')
    .addChannelOption(option =>
      option.setName('채널')
        .setDescription('알림을 받을 음성 채널을 선택하세요. (생략시 현재 참여중인 채널)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(false)
    ),

  // /음성채널해제
  new SlashCommandBuilder()
    .setName('음성채널해제')
    .setDescription('음성 채널 설정을 해제하고 봇을 퇴장시킵니다.')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    if (GUILD_ID) {
      // Guild-specific registration (instant update for testing)
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands }
      );
      console.log(`Successfully reloaded application (/) commands for guild: ${GUILD_ID}`);
    } else {
      // Global registration (takes a few minutes to update worldwide)
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands }
      );
      console.log('Successfully reloaded application (/) commands globally.');
    }
  } catch (error) {
    console.error('Error during command registration:', error);
  }
})();
