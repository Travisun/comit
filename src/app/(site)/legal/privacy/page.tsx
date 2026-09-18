import type { Metadata } from "next";
import { routes } from "@/core/routes";
import { pageMetadata } from "@/lib/seo";
import { LegalDoc, LegalSection } from "../legal-doc";

export const metadata: Metadata = pageMetadata({
  title: "隐私政策",
  description:
    "comit.sh 隐私政策：我们收集哪些数据、如何使用、你的 GDPR 权利（访问、更正、删除、可携带）以及第三方处理说明。你的主页属于你，你的数据同理。",
  path: routes.legal.privacy,
});

export default function PrivacyPage() {
  return (
    <LegalDoc title="隐私政策" updated="2026-09-18">
      <p>
        本政策说明 comit.sh（下称“本平台”）如何收集、使用、存储与保护你的个人数据。你的主页属于你，你的数据同理。本平台以
        GDPR（欧盟《通用数据保护条例》）为合规框架设计数据处理流程，无论你身处何地均参照本政策执行。
      </p>

      <LegalSection
        title="一、我们收集的数据"
      >
        <p>1. <strong>账户资料</strong>：邮箱、用户名、昵称、一句话简介、头像与主页封面，以及你可选填的 GitHub、ORCID、个人网站。</p>
        <p>2. <strong>内容数据</strong>：你发布的文章、短动态、评论、话题、合集，以及点赞、关注、转发等社交行为记录。</p>
        <p>3. <strong>媒体文件</strong>：你上传的图片（自动转换为 WebP 存储）。</p>
        <p>4. <strong>日志数据</strong>：会话记录、IP 地址、User-Agent、登录时间等安全日志，用于账户安全与滥用防护。</p>
        <p>5. <strong>偏好数据</strong>：主题、语言、通知偏好等界面设置。</p>
      </LegalSection>

      <LegalSection
        title="二、使用目的"
      >
        <p>1. 提供并运营核心服务：内容发布、动态流、用户主页、子域名访问、RSS 分发、评论与私信。</p>
        <p>2. 账户安全：强制两步验证、会话管理、异常登录检测与滥用防护。</p>
        <p>3. 通知：按你的偏好设置发送邮件与站内通知（如评论、关注、点赞）。</p>
        <p>4. 内容审核：结合关键词与 LLM 审核保障社区合规。</p>
        <p>5. 履行法律义务与响应执法请求（如适用）。</p>
        <p>我们不会出售你的个人数据。</p>
      </LegalSection>

      <LegalSection
        title="三、法律基础"
      >
        <p>1. <strong>合同履行</strong>（GDPR 第 6(1)(b) 条）：运营你的账户及发布、订阅、子域名等功能。</p>
        <p>2. <strong>正当利益</strong>（第 6(1)(f) 条）：平台安全、反滥用、服务改进与统计。</p>
        <p>3. <strong>同意</strong>（第 6(1)(a) 条）：可选的邮件通知、OAuth 账号绑定等，你可随时撤回。</p>
        <p>4. <strong>法律义务</strong>（第 6(1)(c) 条）：依法留存必要的记录。</p>
      </LegalSection>

      <LegalSection
        title="四、你的权利"
      >
        <p>1. <strong>访问权</strong>：你可以随时查看与获取你的个人数据。</p>
        <p>2. <strong>更正权</strong>：在“设置 → 资料”中直接修改你的资料信息。</p>
        <p>
          3. <strong>删除权（被遗忘权）</strong>：在“设置 → 数据与导出 → 删除账户”中永久删除账户与个人数据。
        </p>
        <p>
          4. <strong>可携带权</strong>：在“设置 → 数据与导出”中一键导出全部文章与媒体（ZIP 包，Markdown
          格式，按日期归档），可直接迁移到其他平台。
        </p>
        <p>5. 你还有权限制或反对处理、撤回同意，以及向监管机构投诉。</p>
        <p>行使上述权利的请求，我们将在 30 日内响应；也可通过联系方式（见下）提出。</p>
      </LegalSection>

      <LegalSection
        title="五、数据保留与删除"
      >
        <p>1. 账户存续期间，你的数据将被保存以维持服务运行。</p>
        <p>
          2. 删除账户后：个人身份信息将被移除或<strong>不可逆匿名化</strong>；依据《服务协议》第二条的许可，已发布内容可能以匿名形式
          （去除作者署名、替换为匿名标识）保留在归档、缓存与研究数据集中。
        </p>
        <p>3. 备份数据在 90 天内滚动清除；安全日志最长保留 180 天。</p>
        <p>4. 法律要求留存的记录，按法定期限保存。</p>
      </LegalSection>

      <LegalSection
        title="六、Cookie 说明"
      >
        <p>1. <strong>会话 Cookie</strong>（<code>mb_session</code>）：维持登录状态，httpOnly + SameSite=Lax，仅用于身份认证，关闭浏览器后按有效期自动过期。</p>
        <p>2. <strong>偏好 Cookie</strong>：主题（明暗）与界面语言选择。</p>
        <p>3. 本平台不使用广告 Cookie、跨站跟踪 Cookie，默认不嵌入第三方统计脚本。</p>
      </LegalSection>

      <LegalSection
        title="七、第三方数据处理"
      >
        <p>1. <strong>OAuth 提供商</strong>（GitHub、Google、X 等）：使用第三方登录时，登录交互数据将由相应提供商按其隐私政策处理。</p>
        <p>2. <strong>邮件服务（SMTP）</strong>：验证邮件与通知邮件经由站点配置的 SMTP 服务商发送。</p>
        <p>
          3. <strong>LLM 审核服务</strong>：站点开启自动审核时，<strong>你提交的内容文本会被发送给所配置的 LLM
          服务商</strong>用于合规性判断；请勿在内容中包含你或他人不希望被第三方处理的敏感信息。
        </p>
        <p>4. 除上述情形及法律要求外，我们不会向其他第三方提供你的个人数据。</p>
      </LegalSection>

      <LegalSection
        title="八、联系我们"
      >
        <p>
          数据保护联系人：[管理员邮箱占位] <br />
          通讯地址：[ postal address 占位] <br />
          邮件主题请注明“隐私请求 / Privacy request”。
        </p>
      </LegalSection>
    </LegalDoc>
  );
}
