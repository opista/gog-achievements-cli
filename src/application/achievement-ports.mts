import type { Game, LibraryGame, Achievement, PublicGame } from '../domain/model.mjs';
import type { Session, SignalOptions } from './auth-ports.mjs';
export interface GogAPIPort {
  exchangeCode(code: string, redirectURI?: string, options?: SignalOptions): Promise<Session>;
  refresh(token: string, game?: Game): Promise<Session>;
  ownedIDs(token: string): Promise<string[]>;
  games(token: string, search?: string): Promise<LibraryGame[]>;
  game(id: string): Promise<Game>;
  achievements(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id'> & Partial<Pick<Session, 'access_token'>>,
  ): Promise<Achievement[]>;
  unlock(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id' | 'access_token'>,
    id: string,
    date: string,
  ): Promise<unknown>;
  lock(
    game: Pick<Game, 'client_id'>,
    session: Pick<Session, 'user_id' | 'access_token'>,
    id: string,
  ): Promise<unknown>;
}

export interface Context {
  session: Session;
  game: Game;
  achievements: Achievement[];
}

export interface GamesResult {
  user_id: string;
  count: number;
  games: LibraryGame[];
}

export interface AchievementsResult {
  user_id: string;
  game: PublicGame;
  count: number;
  achievements: Achievement[];
}
