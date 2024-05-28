import {checkRequiredApprovals} from '../src/check-required-approvals'
import * as core from '@actions/core'

const listReviewsMock = jest.fn()
const listFilesMock = jest.fn()
const createCheckMock = jest.fn()
const updateCheckMock = jest.fn()
const listForRefMock = jest.fn()

jest.mock('@actions/core', () => ({
  info: jest.fn(),
}))

jest.mock('@actions/github', () => {
  return {
    context: {
      eventName: 'pull_request',
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
        checks: {
          create: createCheckMock,
          update: updateCheckMock,
          listForRef: listForRefMock,
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

function mockCheckAlreadyExisting(alreadyExists: boolean) {
  listForRefMock.mockReturnValue({
    data: alreadyExists
      ? {check_runs: [{name: 'Required number of approvals met'}]}
      : {check_runs: []},
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('should "pass" and set the check when no files are matched, and the PR is not approved', async () => {
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

  expect(core.info).toHaveBeenCalledWith(
    'No reviews yet, setting check to successful.',
  )
  expect(createCheckMock).toBeCalledWith(
    expect.objectContaining({
      conclusion: 'success',
      output: expect.objectContaining({
        title: 'No reviews yet',
      }),
    }),
  )
})

it('should "pass" and set the check if the event is pull_request and there are no reviews yet, even with matching files', async () => {
  mockFileList(['src/test.js'])
  mockNumberOfReviews(0)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['src/**/*'],
        requiredApprovals: 1,
      },
    ],
    token: 'foo',
  })

  expect(core.info).toHaveBeenCalledWith(
    'No reviews yet, setting check to successful.',
  )
  expect(createCheckMock).toBeCalledWith(
    expect.objectContaining({
      conclusion: 'success',
      output: expect.objectContaining({
        title: 'No reviews yet',
      }),
    }),
  )
})

it('should "pass" and set the check when files are matched and approvals are met', async () => {
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

  expect(core.info).toHaveBeenCalledWith('All checks passed!')
  expect(createCheckMock).toBeCalledWith(
    expect.objectContaining({
      conclusion: 'success',
      output: expect.objectContaining({
        title: '1/1 approvals',
      }),
    }),
  )
})

it('should "pass" and set the check when multiple patterns are met', async () => {
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

  expect(core.info).toHaveBeenCalledWith('All checks passed!')
  expect(createCheckMock).toBeCalledWith(
    expect.objectContaining({
      conclusion: 'success',
      output: expect.objectContaining({
        title: '2/2 approvals',
      }),
    }),
  )
})

it('should "fail" and not set the check, if there is one requirement that is not met', async () => {
  mockFileList(['src/test.js', '.github/workflows/test.yml'])
  mockCheckAlreadyExisting(false)
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

  expect(core.info).toHaveBeenCalledWith(
    'Required approvals not met for files matching patterns (1/2): .github/**/*',
  )
  expect(core.info).not.toHaveBeenCalledWith('All checks passed!')
  expect(createCheckMock).not.toBeCalled()
  expect(updateCheckMock).not.toBeCalled()
})

it('should "fail" and update the check to in progress when failing, if it already exists', async () => {
  mockFileList(['src/test.js'])
  mockCheckAlreadyExisting(true)
  mockNumberOfReviews(1)

  await checkRequiredApprovals({
    requirements: [
      {
        patterns: ['src/**/*'],
        requiredApprovals: 2,
      },
    ],
    token: 'foo',
  })

  expect(updateCheckMock).toBeCalled()
  expect(core.info).toHaveBeenCalledWith(
    'Setting existing check to in_progress',
  )
  expect(core.info).toHaveBeenCalledWith(
    'Required approvals not met for files matching patterns (1/2): src/**/*',
  )
  expect(createCheckMock).not.toBeCalled()
})
