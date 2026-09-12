"use client";

import { ListChecks, FlaskConical, ShieldAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/primitives";
import { PageHeader } from "@/components/admin/bits";
import { ModerationQueueTab } from "@/components/admin/moderation-queue";
import { ModerationLlmTab } from "@/components/admin/moderation-llm";
import { ModerationKeywordsTab } from "@/components/admin/moderation-keywords";

export default function AdminModerationPage() {
  return (
    <div>
      <PageHeader title="内容审核" description="待审队列、LLM 审核策略与关键词黑名单" />
      <Tabs defaultValue="queue" className="gap-4">
        <TabsList>
          <TabsTrigger value="queue">
            <ListChecks />
            待审队列
          </TabsTrigger>
          <TabsTrigger value="llm">
            <FlaskConical />
            LLM 审核
          </TabsTrigger>
          <TabsTrigger value="keywords">
            <ShieldAlert />
            关键词黑名单
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <ModerationQueueTab />
        </TabsContent>
        <TabsContent value="llm">
          <ModerationLlmTab />
        </TabsContent>
        <TabsContent value="keywords">
          <ModerationKeywordsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
