import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'
import {minimatch} from 'minimatch'

export interface Requirement {
  patterns: string[]
  requiredApprovals: number
}

export interface Config {
  requirements: Requirement[]
  token: string
}

type Octokit = ReturnType<typeof getOctokit>

// Maps all the filenames in the PR to an array of strings
async function getPRFilenames(octokit: Octokit): Promise<string[]> {
  const {data: files} = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request?.number ?? 0,
  })

  return files.map(file => file.filename)
}

// Returns true if any of the filenames match any of the patterns
function hasChangedFilesMatchingPatterns(
  patterns: string[],
  filenames: string[],
): boolean {
  return patterns.some(
    pattern => minimatch.match(filenames, pattern).length > 0,
  )
}

// The main action function.
// Checks if the required approvals are met for the patterns
export async function checkRequiredApprovals(config: Config): Promise<void> {
  let actionFailed = false
  const octokit = getOctokit(config.token)
  const filenames = await getPRFilenames(octokit)

  const {data: reviews} = await octokit.rest.pulls.listReviews({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request?.number ?? 0,
  })

  for (const requirement of config.requirements) {
    const hasChanges = hasChangedFilesMatchingPatterns(
      requirement.patterns,
      filenames,
    )

    if (hasChanges) {
      const approvals = reviews.filter(
        review => review.state === 'APPROVED',
      ).length

      if (approvals < requirement.requiredApprovals) {
        actionFailed = true
        core.info(
          `Required approvals not met for files matching patterns (${approvals}/${
            requirement.requiredApprovals
          }): ${requirement.patterns.join(', ')}`,
        )
      }
    }
  }

  if (actionFailed) {
    core.setFailed(`Required approvals not met for one or more patterns`)
  } else {
    core.info('All checks passed!')
  }
}
