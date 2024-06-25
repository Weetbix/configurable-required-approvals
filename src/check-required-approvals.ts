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

  core.info(`Found ${reviews.length} reviews.`)
  for (const review of reviews) {
    core.info(`- ${review?.user?.login}: (${review.state})`)
  }

  // Always succeed on pull_request events when there are no reviews yet.
  // That way we will not get red Xs on the PR right away.
  if (context.eventName === 'pull_request' && reviews.length === 0) {
    core.info('No reviews yet, skipping check so the PR gets a green tick.')
    return
  }

  // If the event is a pull_request_review, we should re-run the
  // push check, so that it updates its status.
  if (context.eventName === 'pull_request_review') {
    // We need to:
    // - Find the check runs for this commit
    // - Find the workflow runs associated with the check runs
    // - Use the workflow run to determine if the check was part of a pull_request event
    // - Rerun the job associated with the check run
    // There doesn't seem to be an easier way to get this info.
    core.info('Pull request review event, re-running push check.')

    const checksForThisCommit = await octokit.rest.checks.listForRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.payload.pull_request?.head.sha,
      status: 'completed',
      per_page: 100,
    })
    core.info(JSON.stringify({checksForThisCommit}, null, 2))

    core.info(`GITHUB_JOB is ${process.env.GITHUB_JOB}`)
    const approvalChecks = checksForThisCommit.data.check_runs.filter(
      check => check.name === process.env.GITHUB_JOB,
    )
    core.info(JSON.stringify({approvalChecks}, null, 2))

    for (const approvalCheck of approvalChecks) {
      const runId = approvalCheck.html_url?.match(/\/runs\/(\d+)\//)?.[1]
      core.info(
        JSON.stringify({approvalCheck: approvalCheck.id, runId}, null, 2),
      )

      if (runId) {
        const workflowRun = await octokit.rest.actions.getWorkflowRun({
          owner: context.repo.owner,
          repo: context.repo.repo,
          run_id: parseInt(runId),
        })
        core.info(JSON.stringify({workflowRun}, null, 2))

        if (workflowRun.data.event === 'pull_request') {
          const jobId = approvalCheck?.html_url?.match(/\/job\/(\d+)/)?.[1]
          core.info(JSON.stringify({jobId}, null, 2))
          if (jobId) {
            // rerun the workflow job
            core.info(`Re-running pull_request job ${jobId} to update status`)
            await octokit.rest.actions.reRunJobForWorkflowRun({
              owner: context.repo.owner,
              repo: context.repo.repo,
              job_id: parseInt(jobId),
            })
          } else {
            core.info('Could not find a jobId for the check run')
          }
          break
        } else {
          core.info(
            `Workflow run ${workflowRun.data.id} is not a pull_request event, skipping.`,
          )
        }
      } else {
        core.info('Could not find a run_id for the check run')
      }
    }
  }

  // Otherwise ensure all the checks are met
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
          `Expected ${requirement.requiredApprovals} approvals, but the PR only has ${approvals}.`,
        )
        core.info(
          `PR requires ${
            requirement.requiredApprovals
          } due to the following files matching patterns: ${requirement.patterns.join(
            ', \n',
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
}
