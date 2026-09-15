/** 站点外壳（site shell）各布局组件共享的类型。 */

export interface ShellUser {
  id: string;
  username: string;
  displayName: string;
  avatarPath: string | null;
  role: string;
  unreadNotifications: number;
  unreadMessages: number;
}
