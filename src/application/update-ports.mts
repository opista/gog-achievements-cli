export interface UpdateCheck {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  can_update: boolean;
  instructions?: string;
}

export interface UpdateResult extends UpdateCheck {
  updated: boolean;
  previous_version?: string;
  backup_directory?: string;
}

export interface UpdatePort {
  check(options?: { timeoutMs?: number }): Promise<UpdateCheck>;
  install(): Promise<UpdateResult>;
}
