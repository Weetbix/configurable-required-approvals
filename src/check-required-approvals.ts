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
  let requiredApprovalsMet = true
  const octokit = getOctokit(config.token)
  const filenames = await getPRFilenames(octokit)

  const {data: reviews} = await octokit.rest.pulls.listReviews({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request?.number ?? 0,
  })

  const approvals = reviews.filter(review => review.state === 'APPROVED').length

  // Otherwise ensure all the checks are met
  let maxApprovalsRequired = 1
  for (const requirement of config.requirements) {
    const hasChanges = hasChangedFilesMatchingPatterns(
      requirement.patterns,
      filenames,
    )

    if (hasChanges) {
      maxApprovalsRequired = Math.max(
        maxApprovalsRequired,
        requirement.requiredApprovals,
      )

      if (approvals < requirement.requiredApprovals) {
        requiredApprovalsMet = false
        core.info(
          `Required approvals not met for files matching patterns (${approvals}/${
            requirement.requiredApprovals
          }): ${requirement.patterns.join(', ')}`,
        )
      }
    }
  }

  const noReviewsYet =
    context.eventName === 'pull_request' && reviews.length === 0

  const checkTitle = noReviewsYet
    ? 'No reviews yet'
    : `${approvals}/${maxApprovalsRequired} approvals`

  if (
    // Always succeed on pull_request events when there are no reviews yet.
    // That way we will not get red Xs on the PR right away.
    requiredApprovalsMet ||
    noReviewsYet
  ) {
    if (noReviewsYet) {
      core.info('No reviews yet, setting check to successful.')
    } else {
      core.info('All checks passed!')
    }

    await octokit.rest.checks.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name: 'Required number of approvals met',
      head_sha: context.payload.pull_request?.head?.sha ?? context.sha,
      status: 'completed',
      conclusion: 'success',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: {
        title: checkTitle,
        summary: 'All required approvals have been met.',
      },
    })
  } else {
    core.info(`Required approvals not met for one or more patterns.`)

    // If the check already exists, update it so its pending and the
    // PR cannot be merged. Otherwise leave the check missing.
    const checks = await octokit.rest.checks.listForRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.payload.pull_request?.head?.sha ?? context.sha,
    })

    const requiredApprovalsCheck = checks.data.check_runs.find(
      check => check.name === 'Required number of approvals met',
    )

    if (requiredApprovalsCheck) {
      core.info(`Setting existing check to in_progress`)

      await octokit.rest.checks.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        check_run_id: requiredApprovalsCheck.id,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        output: {
          title: checkTitle,
          summary: `${maxApprovalsRequired} approvals are required, but only ${approvals} have been met.`,
        },
      })
    }
  }
}
