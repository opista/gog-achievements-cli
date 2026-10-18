import type { Achievement, PublicGame } from '../domain/model.mjs';

const HEADER = 'game_id,game_title,achievement_id,name,description,hidden,status,unlocked_at';

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function achievementCSV(game: PublicGame, achievements: readonly Achievement[]): string {
  const rows = achievements.map((achievement) =>
    [
      game.id,
      game.title,
      achievement.id,
      achievement.name,
      achievement.description,
      String(achievement.hidden),
      achievement.unlocked ? 'unlocked' : 'locked',
      achievement.unlocked
        ? new Date(achievement.unlocked_at).toISOString().replace('.000Z', 'Z')
        : '',
    ]
      .map(cell)
      .join(','),
  );
  return [HEADER, ...rows].join('\r\n') + '\r\n';
}
