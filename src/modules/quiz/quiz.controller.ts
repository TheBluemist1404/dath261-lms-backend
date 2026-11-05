// quiz.controller.ts
import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
  } from '@nestjs/common';
  import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
  } from '@nestjs/swagger';
  import { UserRole } from '../../generated/prisma/enums.js';
  import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
  import { Roles } from '../authorization/roles.decorator.js';
  import { RolesGuard } from '../authorization/roles.guard.js';
  import { CreateQuizDto } from './dto/create-quiz.dto.js';
  import { PaginatedQuizAttemptResponseDto } from './dto/paginated-quiz-attempt-response.dto.js';
  import { QuizAttemptDetailResponseDto } from './dto/quiz-attempt-detail-response.dto.js';
  import { QuizAttemptListQueryDto } from './dto/quiz-attempt-list-query.dto.js';
  import { QuizAttemptResponseDto } from './dto/quiz-attempt-response.dto.js';
  import { QuizQuestionInputDto } from './dto/quiz-question-input.dto.js';
  import { QuizResponseDto } from './dto/quiz-response.dto.js';
  import { QuizStudentResponseDto } from './dto/quiz-student-response.dto.js';
  import { SubmitQuizAttemptDto } from './dto/submit-quiz-attempt.dto.js';
  import { UpdateQuizConfigDto } from './dto/update-quiz-config.dto.js';
  import { QuizService } from './quiz.service.js';
  
  @ApiTags('Quizzes')
  @ApiBearerAuth('access-token')
  @Controller('courses/:courseId/quizzes')
  export class QuizController {
    constructor(private readonly quizService: QuizService) {}
  
    // ===========================================================================
    // Lecturer — authoring
    // ===========================================================================
  
    @Post()
    @HttpCode(HttpStatus.CREATED)
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'Create a new quiz (CourseBlock type QUIZ + config + questions)',
      description:
        'Creates a QUIZ CourseBlock at the end of the course. The Lecturer must own the course. ' +
        'Question types: SINGLE_CHOICE, MULTIPLE_CHOICE, TRUE_FALSE, FILL_IN_BLANK.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course', example: 'clxcourse1' })
    @ApiCreatedResponse({ description: 'Quiz created successfully.', type: QuizResponseDto })
    @ApiBadRequestResponse({
      description:
        'Invalid input (empty questions, invalid question payload, availableFrom >= deadline).',
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course not found.' })
    create(
      @Param('courseId') courseId: string,
      @Req() req: { user: AuthenticatedUser },
      @Body() dto: CreateQuizDto,
    ): Promise<QuizResponseDto> {
      return this.quizService.createQuiz(courseId, req.user.userId, dto);
    }
  
    @Get(':blockId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({ summary: 'Get a quiz (Lecturer view, includes answer keys)' })
    @ApiParam({ name: 'courseId', description: 'ID of the course', example: 'clxcourse1' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block', example: 'clxblock1' })
    @ApiOkResponse({ description: 'Quiz retrieved.', type: QuizResponseDto })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course, quiz, or quiz config not found.' })
    findOneForLecturer(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
    ): Promise<QuizResponseDto> {
      return this.quizService.getQuizForLecturer(courseId, blockId, req.user.userId);
    }
  
    @Patch(':blockId/config')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'Update quiz configuration (attempts, scoring mode, deadline, late policy)',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({ description: 'Config updated.', type: QuizResponseDto })
    @ApiBadRequestResponse({ description: 'Invalid window (availableFrom >= deadline).' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course, quiz, or quiz config not found.' })
    updateConfig(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
      @Body() dto: UpdateQuizConfigDto,
    ): Promise<QuizResponseDto> {
      return this.quizService.updateConfig(courseId, blockId, req.user.userId, dto);
    }
  
    @Patch(':blockId/questions')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'Replace all questions in the quiz (replace-all semantics)',
      description:
        'Deletes all current questions and recreates them from the payload. ' +
        'Existing attempts are unaffected because answers are stored as snapshots.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({ description: 'Questions replaced.', type: QuizResponseDto })
    @ApiBadRequestResponse({ description: 'Invalid questions payload.' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course or quiz not found.' })
    replaceQuestions(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
      @Body() questions: QuizQuestionInputDto[],
    ): Promise<QuizResponseDto> {
      return this.quizService.replaceQuestions(courseId, blockId, req.user.userId, questions);
    }
  
    @Patch(':blockId/release-results')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'Release quiz results to Students',
      description:
        'Sets resultsReleasedAt to now. Idempotent: calling again does not change the timestamp. ' +
        'After release, Students can view their per-question results and correct answers.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({ description: 'Results released.', type: QuizResponseDto })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course or quiz not found.' })
    releaseResults(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
    ): Promise<QuizResponseDto> {
      return this.quizService.releaseResults(courseId, blockId, req.user.userId);
    }
  
    @Get(':blockId/attempts')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'List all Student attempts for a quiz (Lecturer only)',
      description:
        'Paginated. Ordered by submittedAt DESC, attemptNumber DESC. ' +
        'Includes per-question results and correct answers.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({ description: 'Paginated attempts.', type: PaginatedQuizAttemptResponseDto })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course or quiz not found.' })
    listAttemptsForLecturer(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
      @Query() query: QuizAttemptListQueryDto,
    ): Promise<PaginatedQuizAttemptResponseDto> {
      return this.quizService.listAttemptsForLecturer(
        courseId,
        blockId,
        req.user.userId,
        query,
      );
    }
  
    @Get(':blockId/attempts/:attemptId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.LECTURER)
    @ApiOperation({
      summary: 'Get a specific attempt (Lecturer view, includes correct answers)',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiParam({ name: 'attemptId', description: 'ID of the attempt' })
    @ApiOkResponse({ description: 'Attempt detail.', type: QuizAttemptDetailResponseDto })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You do not own this course.' })
    @ApiNotFoundResponse({ description: 'Course, quiz, or attempt not found.' })
    getAttemptForLecturer(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Param('attemptId') attemptId: string,
      @Req() req: { user: AuthenticatedUser },
    ): Promise<QuizAttemptDetailResponseDto> {
      return this.quizService.getAttemptForLecturer(
        courseId,
        blockId,
        attemptId,
        req.user.userId,
      );
    }
  
    // ===========================================================================
    // Student — taking
    // ===========================================================================
  
    @Get(':blockId/student')
    @UseGuards(RolesGuard)
    @Roles(UserRole.STUDENT)
    @ApiOperation({
      summary: 'Get a quiz for taking (Student view, no answer keys)',
      description:
        'Requires an ACTIVE enrollment in the course. Rejects if the quiz is not yet available. ' +
        'Payload never includes correctBoolean, acceptedAnswers, or isCorrect.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({ description: 'Quiz for Student.', type: QuizStudentResponseDto })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({
      description: 'You are not enrolled in this course, or the quiz is not available yet.',
    })
    @ApiNotFoundResponse({ description: 'Course, quiz, or quiz config not found.' })
    findOneForStudent(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
    ): Promise<QuizStudentResponseDto> {
      return this.quizService.getQuizForStudent(courseId, blockId, req.user.userId);
    }
  
    @Get(':blockId/my-latest-attempt')
    @UseGuards(RolesGuard)
    @Roles(UserRole.STUDENT)
    @ApiOperation({
      summary: 'Get my latest attempt for this quiz',
      description:
        'Returns the attempt with the highest attemptNumber for the current Student. ' +
        'Returns null if the Student has not submitted any attempt yet. ' +
        'When results are not released, answers is null.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiOkResponse({
      description: 'Latest attempt (or null).',
      type: QuizAttemptResponseDto,
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({ description: 'You are not enrolled in this course.' })
    @ApiNotFoundResponse({ description: 'Course or quiz not found.' })
    getMyLatestAttempt(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
    ): Promise<QuizAttemptResponseDto | null> {
      return this.quizService.getMyLatestAttempt(courseId, blockId, req.user.userId);
    }
  
    @Post(':blockId/attempts')
    @HttpCode(HttpStatus.CREATED)
    @UseGuards(RolesGuard)
    @Roles(UserRole.STUDENT)
    @ApiOperation({
      summary: 'Submit a quiz attempt (auto-graded)',
      description:
        'Creates the attempt, computes its score, and stores it in one step. ' +
        'Enforces attempt limit, availability window, and late policy on the server. ' +
        'Late submissions are only accepted when allowLate = true and are flagged isLate = true.',
    })
    @ApiParam({ name: 'courseId', description: 'ID of the course' })
    @ApiParam({ name: 'blockId', description: 'ID of the QUIZ block' })
    @ApiCreatedResponse({
      description: 'Attempt submitted and graded.',
      type: QuizAttemptResponseDto,
    })
    @ApiBadRequestResponse({ description: 'Invalid answers payload.' })
    @ApiConflictResponse({ description: 'Maximum number of attempts reached.' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
    @ApiForbiddenResponse({
      description:
        'Not enrolled, quiz not available yet, deadline passed with late submissions disabled.',
    })
    @ApiNotFoundResponse({ description: 'Course, quiz, or quiz config not found.' })
    submitAttempt(
      @Param('courseId') courseId: string,
      @Param('blockId') blockId: string,
      @Req() req: { user: AuthenticatedUser },
      @Body() dto: SubmitQuizAttemptDto,
    ): Promise<QuizAttemptResponseDto> {
      return this.quizService.submitAttempt(courseId, blockId, req.user.userId, dto);
    }
  }