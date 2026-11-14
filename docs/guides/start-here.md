# Start here

Pick the line that sounds like you. Each path ends in something you can do the same day.

| I am a… | I want to… | Read |
|---|---|---|
| **Developer** | understand an instance and change it with my coding agent | [10 minutes to a first answer](#10-minutes-to-a-first-answer), then [build a capability](build-a-capability.md) |
| **Platform owner or admin** | know what snagentic can and can't do to my instances | [Security and governance](../product/security-and-governance.md), [credentials](credentials.md), [load limits](../getting-started.md#4-pull-then-integrate) |
| **Technical lead or architect** | review changes as diffs, and keep a team on one mirror | [Team mode](team-mode.md), [spec-driven development](spec-driven-development.md), [recipes](recipes.md#review) |
| **Documentation owner** | documentation that says when it is wrong | [Generate documentation](generate-documentation.md) |
| **Decision maker** | decide whether this is worth it | [Product overview](../product/overview.md), and the [short videos](../../media/product-videos/README.md) |
| **Contributor to snagentic** | add a command, a rule or a skill | [Extending snagentic](extend-snagentic.md), [AGENTS.md](../../AGENTS.md) |

## 10 minutes to a first answer

1. **Install** (macOS, Linux or Windows):

   ```sh
   curl -fsSL https://github.com/caabayfe/agenticsn/releases/latest/download/install.sh | sh
   ```

   Windows: `irm https://github.com/caabayfe/agenticsn/releases/latest/download/install.ps1 | iex`.
2. **Onboard** your development instance. A PDI is the easy place to start; wake it first at
   developer.servicenow.com if it has been idle:

   ```sh
   snagentic onboard dev --url dev12345 --username admin
   ```

   It asks for the password without showing it, checks the instance, and pulls it into git. The
   first pull of a PDI takes about half an hour and resumes if it stops. If it stops with a message,
   the message says what to do ([onboarding](onboarding.md)).
3. **Ask a question** of the mirror, with no load on the instance:

   ```sh
   cd ~/snagentic/dev
   snagentic describe incident            # what runs when you save, in order
   snagentic find "assignment group" --code --table incident
   ```
4. **Give your agent the tools**: `snagentic agent install`, commit the files it lists, then ask in plain
   words, *"Why does the assignment group change when I save an incident?"*

When you are ready to change something, follow [build a capability](build-a-capability.md): nothing
reaches an instance until you have read the plan and said yes, and only development instances can be
changed.

## When something goes wrong

| Symptom | Go to |
|---|---|
| A PDI is asleep, or refuses the user (401) | [Onboarding](onboarding.md#one-command) |
| `pull` is slow, interrupted or incomplete | [Sync, when something goes wrong](sync.md#when-something-goes-wrong) |
| Behind a proxy, or a corporate certificate | [Network](network.md) |
| The password, OAuth, CI credentials | [Credentials](credentials.md) |
| `validate` or `plan-push` refuses | [Build a capability, when something goes wrong](build-a-capability.md#when-something-goes-wrong) |
| A team shares one mirror and it looks stale | [Team mode, troubleshooting](team-mode.md) |
| Anything else about your setup | `snagentic doctor --instance dev` |

Words you meet along the way are in the [glossary](glossary.md); every command is in the
[command reference](../reference/commands.md).
