import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'
import {minimatch} from 'minimatch'

type Octokit = ReturnType<typeof getOctokit>

interface Requirement {
  patterns: string[]
  requiredApprovals: number
}

interface Config {
  requirements: Requirement[]
  token: string
}

async function getPRFilenames(octokit: Octokit): Promise<string[]> {
  const {data: files} = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request?.number ?? 0,
  })

  return files.map(file => file.filename)
}

function hasChangedFilesMatchingPatterns(
  patterns: string[],
  filenames: string[],
): boolean {
  return patterns.some(
    pattern => minimatch.match(filenames, pattern).length > 0,
  )
}

async function run(): Promise<void> {
  try {
    const config: Config = {
      requirements: core.getInput('requirements', {
        required: true,
      }) as unknown as Requirement[],
      token: core.getInput('github-token', {required: true}),
    }

    let actionFailed = false
    const octokit = getOctokit(config.token)
    const filenames = await getPRFilenames(octokit)

    for (const requirement of config.requirements) {
      const hasChanges = await hasChangedFilesMatchingPatterns(
        requirement.patterns,
        filenames,
      )

      if (hasChanges) {
        const {data: reviews} = await octokit.rest.pulls.listReviews({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: context.payload.pull_request?.number ?? 0,
        })

        const approvals = reviews.filter(
          review => review.state === 'APPROVED',
        ).length

        if (approvals < requirement.requiredApprovals) {
          actionFailed = true
          core.info(
            `Required approvals not met for files matching patterns: ${requirement.patterns.join(
              ', ',
            )}`,
          )
        }
      }
    }

    if (actionFailed) {
      core.setFailed(`Required approvals not met for one or more patterns`)
    } else {
      core.info('All checks passed!')
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(`Action failed with error: ${error.message}`)
    } else {
      core.setFailed(`Action failed.`)
    }
  }
}

run()
