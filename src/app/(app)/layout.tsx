import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/api';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return (
    <Shell user={{ id: user.id, name: user.name, username: user.username, role: user.role }}>
      {children}
    </Shell>
  );
}
