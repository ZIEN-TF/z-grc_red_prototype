import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { ProjectSidebar } from "./sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      manufacturer: true,
      screeningComplete: true,
      userId: true,
      _count: { select: { assets: true, dtAnswers: true } },
    },
  });
  if (!project) notFound();
  if (session.role !== "consultant" && project.userId !== session.userId) {
    redirect("/forbidden");
  }

  // Completion flags for sidebar badges.
  const hasDTAnswers = project._count.dtAnswers > 0;

  const sidebarProject = {
    id: project.id,
    name: project.name,
    manufacturer: project.manufacturer,
    screeningComplete: project.screeningComplete,
    hasAssets: project._count.assets > 0,
    hasDTAnswers,
  };

  return (
    <div className="flex gap-6">
      <ProjectSidebar project={sidebarProject} role={session.role} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
