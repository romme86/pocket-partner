export type Group = {
  id: string;
  name: string;
  owner_uid: string;
  role: 'owner' | 'editor' | 'member';
};
export type Script = {
  id: string;
  group_id: string;
  title: string;
  author: string;
  kind: 'play' | 'scene';
  color: number;
  scene_count: number;
  character_count: number;
  original_file_id?: string;
};
export type Character = {
  id: string;
  name: string;
  script_id: string;
  voice_id: string;
  delivery: 'neutral' | 'expressive';
};
export type Scene = {
  id: string;
  script_id: string;
  title: string;
  position: number;
  line_count: number;
  missing_audio: number;
  group_id?: string;
  script_title?: string;
};
export type Line = {
  id: string;
  scene_id: string;
  character_id: string | null;
  speaker: string | null;
  text: string;
  position: number;
  revision: number;
  audio_id: string | null;
  audio_kind: 'recorded' | 'ai' | null;
};
export type SceneData = {
  scene: Scene;
  lines: Line[];
  jobs: { id: string; line_id: string; status: string; error: string | null }[];
};
export type ScriptData = { script: Script; role: string; scenes: Scene[]; characters: Character[] };
export type GroupData = {
  role: string;
  members: { uid: string; name: string; email: string; role: string }[];
  scripts: Script[];
  invitations: {
    id: string;
    role: string;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
  }[];
  budget: { groupRemaining: number; globalRemaining: number; enabled: boolean };
};
export type Me = { user: { uid: string; email: string; name: string }; groups: Group[] };
export type Practice = {
  line_id: string;
  scene_id: string;
  script_id: string;
  script_title: string;
  scene_title: string;
  speaker: string;
  text: string;
  position: number;
  score: number;
  hints: number;
  repeats: number;
  remembered: number;
  saved: boolean;
};
export const colors = [
  { name: 'Curtain red', bg: '#8b3a49', ink: '#f1d5a1' },
  { name: 'Forest', bg: '#354b44', ink: '#eddfa9' },
  { name: 'Theater gold', bg: '#d9c399', ink: '#533d34' },
  { name: 'Midnight', bg: '#303f56', ink: '#e5ddcb' },
  { name: 'Plum', bg: '#4b414f', ink: '#ead3a7' },
];
