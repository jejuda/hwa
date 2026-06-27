import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Error: DISCORD_TOKEN and CLIENT_ID must be specified in the .env file.');
  process.exit(1);
}

const commands = [


  // /보스수정 [이름] [젠주기] [메모]
  new SlashCommandBuilder()
    .setName('보스수정')
    .setDescription('등록된 보스의 정보를 수정합니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('수정할 보스의 이름을 입력하세요.')
        .setRequired(true)
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

  // /컷 [이름] [시간]
  new SlashCommandBuilder()
    .setName('컷')
    .setDescription('보스 처치(컷) 시간을 기록합니다.')
    .addStringOption(option =>
      option.setName('이름')
        .setDescription('처치한 보스 이름을 입력하세요.')
        .setRequired(true)
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
        .setDescription('보스 이름을 입력하세요.')
        .setRequired(true)
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
        .setDescription('되돌릴 보스 이름을 입력하세요.')
        .setRequired(true)
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
    .setDescription('음성 채널 설정을 해제하고 봇을 퇴장시킵니다.'),

  // /대시보드
  new SlashCommandBuilder()
    .setName('대시보드')
    .setDescription('웹 대시보드 바로가기 링크를 확인합니다.'),

  // /대시보드설정 [주소]
  new SlashCommandBuilder()
    .setName('대시보드설정')
    .setDescription('대시보드 웹 주소를 설정합니다.')
    .addStringOption(option =>
      option.setName('주소')
        .setDescription('웹 주소를 입력해 주세요. (예: http://node1.dishost.kr:12345)')
        .setRequired(true)
    )
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
