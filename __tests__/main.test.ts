import {checkRequiredApprovals} from '../src/check-required-approvals'
import * as core from '@actions/core'

const listReviewsMock = jest.fn()
const listFilesMock = jest.fn()

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  setFailed: jest.fn(),
}))

jest.mock('@actions/github', () => {
  return {
    context: {
      repo: {
        owner: 'mocked-owner-value',
        repo: 'mocked-repo-value',
      },
      payload: {
        pull_request: {
          number: 99,
        },
      },
    },
    getOctokit: jest.fn(() => ({
      rest: {
        pulls: {
          listReviews: listReviewsMock,
          listFiles: listFilesMock,
        },
      },
    })),
  }
})

function mockFileList(filenames: string[]) {
  listFilesMock.mockReturnValue({
    data: filenames.map(filename => ({filename})),
  })
}

function mockNumberOfReviews(number: number) {
  listReviewsMock.mockReturnValue({
    data: Array(number).fill({state: 'APPROVED'}),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('should pass when no files are matched, and the PR is not approved', async () => {
  mockFileList(['foo', 'bar'])
  mockNumberOfReviews(0)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['no-match'],
        requiredApprovals: 1,
      },
    ],
    token: 'foo',
  })

  expect(core.setFailed).not.toBeCalled()
  expect(core.info).toHaveBeenCalledWith('All checks passed!')
})

it('should pass when files are matched and approvals are met', async () => {
  mockFileList(['src/test.js'])
  mockNumberOfReviews(1)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['src/**/*'],
        requiredApprovals: 1,
      },
    ],
    token: 'foo',
  })

  expect(core.setFailed).not.toBeCalled()
  expect(core.info).toHaveBeenCalledWith('All checks passed!')
})

it('should pass when multiple patterns are met', async () => {
  mockFileList(['src/test.js', '.github/workflows/test.yml'])
  mockNumberOfReviews(2)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['src/**/*'],
        requiredApprovals: 1,
      },
      {
        patterns: ['.github/**/*'],
        requiredApprovals: 2,
      },
    ],
    token: 'foo',
  })

  expect(core.setFailed).not.toBeCalled()
  expect(core.info).toHaveBeenCalledWith('All checks passed!')
})

it('should fail if there is one requirement that is not met', async () => {
  mockFileList(['src/test.js', '.github/workflows/test.yml'])
  mockNumberOfReviews(1)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['src/**/*'],
        requiredApprovals: 1,
      },
      {
        patterns: ['.github/**/*'],
        requiredApprovals: 2,
      },
    ],
    token: 'foo',
  })

  expect(core.setFailed).toHaveBeenCalledWith(
    'Required approvals not met for one or more patterns',
  )
  expect(core.info).toHaveBeenCalledWith(
    'Required approvals not met for files matching patterns (1/2): .github/**/*',
  )
  expect(core.info).not.toHaveBeenCalledWith('All checks passed!')
})
