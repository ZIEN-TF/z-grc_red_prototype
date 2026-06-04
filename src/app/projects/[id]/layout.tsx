import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { ProjectSidebar } from "./sidebar";
import { WorkflowBanner } from "./workflow-banner";
import type { Phase } from "@/lib/workflow";

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
      phase: true,
      _count: { select: { assets: true, dtAnswers: true } },
    },
  });
  if (!project) notFound();
  if (session.role !== "consultant" && project.userId !== session.userId) {
    redirect("/forbidden");
  }

  // If the AI stage for a "*_RUNNING" phase failed, surface a retry in the banner.
  let aiFailed = false;
  if (project.phase.endsWith("_RUNNING")) {
    const run = await prisma.aiPipelineRun.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    aiFailed = run?.status === "failed";
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
      <div className="min-w-0 flex-1">
        <WorkflowBanner
          projectId={project.id}
          phase={project.phase as Phase}
          role={session.role}
          ownerless={!project.userId}
          aiFailed={aiFailed}
        />
        {children}
      </div>
    </div>
  );
}
